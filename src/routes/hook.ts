import { Hono } from "hono";
import type { Env, LogEntry } from "../types.js";
import type { KoboSubmission } from "../lib/kobo.js";
import { isAllowedMediaHost } from "../lib/kobo.js";
import { forwardSubmission } from "../lib/forward.js";
import { resolveSubmissionId, editSubmission, resolveKoboEditToken, updateValidationStatus } from "../lib/koboEdit.js";
import { geocodeSubmission } from "../lib/geocode.js";
import { callValidationAI } from "../lib/validateSubmission.js";

const hook = new Hono<{ Bindings: Env }>();

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function generateEmailBody(
  apiKey: string,
  instructions: string,
  submission: Record<string, unknown>
): Promise<string> {
  const systemPrompt = [
    "You are an assistant that generates HTML email bodies for form submission notifications.",
    "Format the output as a complete HTML fragment (no <html>/<head>/<body> tags — just the inner content).",
    "Use inline styles. Keep it clean and professional.",
    instructions,
  ].join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Submission data:\n${JSON.stringify(submission, null, 2)}` },
        ],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) {
      console.error(`[email/ai] OpenAI error ${res.status}`);
      return `<p>A new submission was received.</p><pre>${JSON.stringify(submission, null, 2)}</pre>`;
    }
    const data = await res.json<{ choices: Array<{ message: { content: string } }> }>();
    return data.choices?.[0]?.message?.content?.trim() ?? "<p>A new submission was received.</p>";
  } catch (e) {
    console.error(`[email/ai] Error generating body: ${e}`);
    return "<p>A new submission was received.</p>";
  }
}

async function sendResendEmail(
  apiKey: string,
  from: string,
  cfg: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body?: string; aiBody?: { instructions: string } },
  htmlBody: string,
  attachments?: Array<{ filename: string; content: string }>
): Promise<void> {
  const payload: Record<string, unknown> = {
    from,
    to: cfg.to,
    subject: cfg.subject,
    html: htmlBody,
  };
  if (cfg.cc?.length) payload.cc = cfg.cc;
  if (cfg.bcc?.length) payload.bcc = cfg.bcc;
  if (attachments?.length) payload.attachments = attachments;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] Resend error ${res.status}: ${text.slice(0, 200)}`);
  }
}

hook.post("/:formUID", async (c) => {
  const formUID = c.req.param("formUID");

  // Enforce body size limit
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return c.text("Payload too large", 413);
  }

  // Read body and validate JSON
  let body: unknown;
  try {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return c.text("Payload too large", 413);
    }
    body = JSON.parse(raw);
  } catch {
    return c.text("Invalid JSON", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.text("Expected a JSON object", 400);
  }

  // Forward to the FormSession Durable Object for this formUID
  const id = c.env.FORM_SESSION.idFromName(formUID);
  const stub = c.env.FORM_SESSION.get(id);

  const doResponse = await stub.fetch("https://do/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!doResponse.ok) {
    return c.text("Failed to relay submission", 502);
  }

  // Fire-and-forget forwarding / editing if a config is stored for this form
  const fwdConfig = await c.env.FORWARD_CONFIG.get(formUID);
  if (fwdConfig) {
    const { forwardUrl, forwardToken, fields, transcribe, extract, analyzeAudio, extractText, forwardMedia, appendValues, editOriginal, geocode, geocodeField, server, emailNotification, validateSubmission } = JSON.parse(fwdConfig) as {
      forwardUrl?: string;
      forwardToken?: string;
      fields?: string[];
      transcribe?: { questions: string[]; model?: string; prompt?: string };
      extract?: { questions: string[]; model?: string; prompts?: Record<string, string> };
      analyzeAudio?: { questions: string[]; model?: string; prompts?: Record<string, string> };
      extractText?: { questions: string[]; model?: string; prompts?: Record<string, string> };
      forwardMedia?: string[];
      appendValues?: Array<{ key: string; value: string }>;
      editOriginal?: boolean;
      geocode?: boolean;
      geocodeField?: string;
      server?: string;
      emailNotification?: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body?: string; aiBody?: { instructions: string }; attachments?: string[] };
      validateSubmission?: { instructions: string; includeReasoning: boolean; options: { approved: string; notApproved: string; onHold: string } };
    };
    if (forwardUrl || editOriginal || geocode || transcribe || extract || analyzeAudio || extractText || emailNotification || validateSubmission) {
      const submission = body as KoboSubmission;

      // Build a filtered payload if the user has specified a fields subset (forwarding only)
      let jsonPayload: Record<string, unknown> | undefined;
      if (forwardUrl) {
        if (fields && fields.length > 0) {
          const filtered: Record<string, unknown> = {};
          // _uuid is always included regardless of the fields filter
          const fieldsWithUuid = fields.includes("_uuid") ? fields : ["_uuid", ...fields];
          for (const f of fieldsWithUuid) {
            if (Object.prototype.hasOwnProperty.call(submission, f)) {
              filtered[f] = (submission as Record<string, unknown>)[f];
            }
          }
          if (Object.keys(filtered).length > 0) {
            jsonPayload = filtered;
          } else {
            console.warn(
              `[hook] None of the configured fields [${fields.join(", ")}] matched the submission keys. Forwarding full submission.`
            );
          }
        }

        // Inject configured key-value pairs under _metadata in the forwarded payload
        if (appendValues && appendValues.length > 0) {
          const meta: Record<string, string> = {};
          for (const { key, value } of appendValues) {
            meta[key] = value;
          }
          if (!jsonPayload) {
            jsonPayload = { ...(submission as Record<string, unknown>) };
          }
          jsonPayload._metadata = meta;
        }
      }

      const openaiApiKey = c.env.OPENAI_API_KEY || undefined;

      c.executionCtx.waitUntil(
        (async () => {
          // ── Geocode coordinates → P-codes (runs first so result is included in forward payload) ──
          let geoFields: Record<string, string> = {};
          if (geocode) {
            let geoLat = NaN, geoLon = NaN;
            if (geocodeField) {
              const raw = (submission as Record<string, unknown>)[geocodeField];
              if (typeof raw === "string" && raw.trim()) {
                const parts = raw.trim().split(/\s+/);
                geoLat = parseFloat(parts[0]);
                geoLon = parseFloat(parts[1]);
              }
            } else if (Array.isArray(submission._geolocation) && submission._geolocation.length >= 2) {
              const rawLat = (submission._geolocation as unknown[])[0];
              const rawLon = (submission._geolocation as unknown[])[1];
              geoLat = typeof rawLat === "number" ? rawLat : typeof rawLat === "string" ? parseFloat(rawLat) : NaN;
              geoLon = typeof rawLon === "number" ? rawLon : typeof rawLon === "string" ? parseFloat(rawLon) : NaN;
            }
            if (!isNaN(geoLat) && !isNaN(geoLon)) {
              const raw = await geocodeSubmission(geoLat, geoLon);
              // Prefix each field with the geopoint question xpath:
              //   _geo_adm0_pcode → obs/Location_geo_adm0_pcode
              const prefix = geocodeField ?? "";
              for (const [k, v] of Object.entries(raw)) {
                geoFields[`${prefix}${k}`] = v;
              }
            }
          }
          // Merge geo fields into the forwarded payload
          const enrichedPayload = Object.keys(geoFields).length > 0
            ? { ...(jsonPayload ?? (submission as Record<string, unknown>)), ...geoFields }
            : jsonPayload;

          // ── Step 1: Forward submission (and/or enrich) ───────────────────
          let fwdResult: Awaited<ReturnType<typeof forwardSubmission>> | undefined;
          if (forwardUrl || transcribe || extract || analyzeAudio || extractText) {
            fwdResult = await forwardSubmission(
              submission,
              forwardUrl,
              c.env.DEFAULT_KOBO_BASE_URL,
              {
                global: c.env.KOBO_API_TOKEN_GLOBAL,
                eu: c.env.KOBO_API_TOKEN_EU,
              },
              enrichedPayload,
              forwardToken || undefined,
              transcribe || undefined,
              openaiApiKey,
              forwardMedia || undefined,
              extract || undefined,
              analyzeAudio || undefined,
              extractText || undefined
            );
          }

          // ── Step 2: Edit original submission ─────────────────────────────
          let editOk: boolean | undefined;
          let editHttpStatus: number | undefined;
          let editError: string | undefined;

          // Resolve _id once if either editOriginal or validateSubmission needs it
          let resolvedSubmissionId: number | null | undefined; // undefined = not yet resolved
          const needsId = (editOriginal || !!validateSubmission) && !!server && !!submission._uuid;
          let koboEditToken: string | undefined;
          if (needsId && server) {
            koboEditToken = resolveKoboEditToken(server, {
              global: c.env.KOBO_API_TOKEN_GLOBAL,
              eu: c.env.KOBO_API_TOKEN_EU,
            });
            resolvedSubmissionId = await resolveSubmissionId(server, formUID, submission._uuid!, koboEditToken);
          }

          if (editOriginal && server && submission._uuid) {
            // Build edit payload: flat appendValues + enrichment from forward step.
            // _uuid must never be written back as a field value.
            const editData: Record<string, string> = {};
            for (const { key, value } of appendValues ?? []) {
              if (key !== "_uuid") editData[key] = value;
            }
            for (const [k, v] of Object.entries(fwdResult?.enrichment ?? {})) {
              if (k !== "_uuid") editData[k] = v;
            }

            if (Object.keys(editData).length > 0) {
              if (resolvedSubmissionId !== null && resolvedSubmissionId !== undefined) {
                const editResult = await editSubmission(server, formUID, resolvedSubmissionId, editData, koboEditToken!);
                editOk = editResult.ok;
                editHttpStatus = editResult.httpStatus;
                editError = editResult.error;
              } else {
                editOk = false;
                editError = "Could not resolve _id from _uuid";
              }
            }
          }

          // ── Step 3: Validate submission with AI ───────────────────────────
          let validateOk: boolean | undefined;
          let validateHttpStatus: number | undefined;
          let validateError: string | undefined;

          if (validateSubmission && server && submission._uuid && openaiApiKey) {
            const valId = resolvedSubmissionId !== undefined
              ? resolvedSubmissionId
              : await resolveSubmissionId(server, formUID, submission._uuid, koboEditToken ?? resolveKoboEditToken(server, { global: c.env.KOBO_API_TOKEN_GLOBAL, eu: c.env.KOBO_API_TOKEN_EU }));

            if (valId !== null) {
              const aiResult = await callValidationAI(
                openaiApiKey,
                submission as Record<string, unknown>,
                validateSubmission.instructions,
                validateSubmission.options
              );
              if (aiResult) {
                const statusMap = {
                  approved: "validation_status_approved",
                  not_approved: "validation_status_not_approved",
                  on_hold: "validation_status_on_hold",
                } as const;
                const vToken = koboEditToken ?? resolveKoboEditToken(server, { global: c.env.KOBO_API_TOKEN_GLOBAL, eu: c.env.KOBO_API_TOKEN_EU });
                const valResult = await updateValidationStatus(server, formUID, valId, statusMap[aiResult.decision], vToken);
                validateOk = valResult.ok;
                validateHttpStatus = valResult.httpStatus;
                validateError = valResult.error;

                // Optionally write reasoning back to the submission
                if (validateSubmission.includeReasoning && aiResult.reasoning) {
                  await editSubmission(server, formUID, valId, { _ai_validation_reasoning: aiResult.reasoning }, vToken);
                }
              } else {
                validateOk = false;
                validateError = "AI returned no result";
              }
            } else {
              validateOk = false;
              validateError = "Could not resolve _id from _uuid";
            }
          }

          // ── Log ──────────────────────────────────────────────────────────
          // Strip `enrichment` from the log entry — it's internal data only.
          const { enrichment: _enrichment, ...fwdResultForLog } = fwdResult ?? { ok: true };
          const logEntry: LogEntry = {
            ts: Date.now(),
            uuid: submission._uuid,
            id: submission._id,
            ...fwdResultForLog,
            ...(editOk !== undefined ? { editOk } : {}),
            ...(editHttpStatus !== undefined ? { editHttpStatus } : {}),
            ...(editError !== undefined ? { editError } : {}),
            ...(validateOk !== undefined ? { validateOk } : {}),
            ...(validateHttpStatus !== undefined ? { validateHttpStatus } : {}),
            ...(validateError !== undefined ? { validateError } : {}),
          };
          await stub.fetch("https://do/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(logEntry),
          });

          // ── Step 3: Send email notification ──────────────────────────────
          if (emailNotification && c.env.RESEND_API_KEY && c.env.RESEND_FROM_EMAIL) {
            // Merge enrichment (transcripts, AI descriptions) into the payload sent to the LLM
            const emailPayload: Record<string, unknown> = {
              ...(jsonPayload ?? (submission as Record<string, unknown>)),
              ...(fwdResult?.enrichment ?? {}),
            };
            const fill = (s: string) =>
              s.replace(/\{\{([\w.]+)\}\}/g, (_, k) => String((emailPayload as Record<string, unknown>)[k] ?? ""));
            const subject = fill(emailNotification.subject);
            let htmlBody: string;
            if (emailNotification.aiBody && c.env.OPENAI_API_KEY) {
              htmlBody = await generateEmailBody(
                c.env.OPENAI_API_KEY,
                emailNotification.aiBody.instructions,
                emailPayload as Record<string, unknown>
              );
            } else {
              const text = fill(emailNotification.body ?? "");
              htmlBody = '<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">'
                + text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                       .replace(/\n/g, "<br>")
                + "</div>";
            }

            // Build attachment list by fetching configured media from Kobo
            const emailAttachments: Array<{ filename: string; content: string }> = [];
            if (emailNotification.attachments?.length && submission._attachments?.length) {
              const koboServer = server ?? c.env.DEFAULT_KOBO_BASE_URL;
              const attToken = resolveKoboEditToken(koboServer, {
                global: c.env.KOBO_API_TOKEN_GLOBAL,
                eu: c.env.KOBO_API_TOKEN_EU,
              });
              for (const xpath of emailNotification.attachments) {
                const att = submission._attachments.find(
                  (a) => !a.is_deleted && a.question_xpath === xpath
                );
                if (!att) continue;
                if (!isAllowedMediaHost(att.download_url, koboServer)) continue;
                try {
                  const mediaRes = await fetch(att.download_url, {
                    headers: { Authorization: `Token ${attToken}` },
                  });
                  if (!mediaRes.ok) {
                    console.error(`[email] Failed to fetch attachment ${att.media_file_basename}: ${mediaRes.status}`);
                    continue;
                  }
                  const buf = await mediaRes.arrayBuffer();
                  emailAttachments.push({
                    filename: att.media_file_basename,
                    content: arrayBufferToBase64(buf),
                  });
                } catch (e) {
                  console.error(`[email] Error fetching attachment ${att.media_file_basename}: ${e}`);
                }
              }
            }

            await sendResendEmail(
              c.env.RESEND_API_KEY,
              c.env.RESEND_FROM_EMAIL,
              { ...emailNotification, subject },
              htmlBody,
              emailAttachments.length ? emailAttachments : undefined
            );
          }

          // ── Step 4: Write geocoded P-codes back to the original Kobo submission ──
          if (Object.keys(geoFields).length > 0 && submission._uuid) {
            const geoServer = server ?? c.env.DEFAULT_KOBO_BASE_URL;
            const koboToken = resolveKoboEditToken(geoServer, {
              global: c.env.KOBO_API_TOKEN_GLOBAL,
              eu: c.env.KOBO_API_TOKEN_EU,
            });
            const submissionId = await resolveSubmissionId(geoServer, formUID, submission._uuid, koboToken);
            if (submissionId !== null) {
              await editSubmission(geoServer, formUID, submissionId, geoFields, koboToken);
            }
          }
        })()
      );
    }
  }

  return c.text("OK", 200);
});

export default hook;
