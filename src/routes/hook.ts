import { Hono } from "hono";
import type { Env, LogEntry } from "../types.js";
import type { KoboSubmission } from "../lib/kobo.js";
import { forwardSubmission } from "../lib/forward.js";
import { resolveSubmissionId, editSubmission, resolveKoboEditToken } from "../lib/koboEdit.js";

const hook = new Hono<{ Bindings: Env }>();

const MAX_BODY_BYTES = 1_048_576; // 1 MB

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
    const { forwardUrl, forwardToken, fields, transcribe, describe, extract, analyzeAudio, extractText, forwardMedia, appendValues, editOriginal, server } = JSON.parse(fwdConfig) as {
      forwardUrl?: string;
      forwardToken?: string;
      fields?: string[];
      transcribe?: { questions: string[]; model?: string; prompt?: string };
      describe?: { questions: string[]; model?: string; prompt?: string };
      extract?: { questions: string[]; model?: string; prompt?: string };
      analyzeAudio?: { questions: string[]; model?: string; prompt?: string };
      extractText?: { questions: string[]; model?: string; prompt?: string };
      forwardMedia?: string[];
      appendValues?: Array<{ key: string; value: string }>;
      editOriginal?: boolean;
      server?: string;
    };
    if (forwardUrl || editOriginal || transcribe || describe || extract || analyzeAudio || extractText) {
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
          // ── Step 1: Forward submission (and/or enrich) ───────────────────
          let fwdResult: Awaited<ReturnType<typeof forwardSubmission>> | undefined;
          if (forwardUrl || transcribe || describe || extract || analyzeAudio || extractText) {
            fwdResult = await forwardSubmission(
              submission,
              forwardUrl,
              c.env.DEFAULT_KOBO_BASE_URL,
              {
                global: c.env.KOBO_API_TOKEN_GLOBAL,
                eu: c.env.KOBO_API_TOKEN_EU,
              },
              jsonPayload,
              forwardToken || undefined,
              transcribe || undefined,
              openaiApiKey,
              describe || undefined,
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
              const koboToken = resolveKoboEditToken(server, {
                global: c.env.KOBO_API_TOKEN_GLOBAL,
                eu: c.env.KOBO_API_TOKEN_EU,
              });
              const submissionId = await resolveSubmissionId(server, formUID, submission._uuid, koboToken);
              if (submissionId !== null) {
                const editResult = await editSubmission(server, formUID, submissionId, editData, koboToken);
                editOk = editResult.ok;
                editHttpStatus = editResult.httpStatus;
                editError = editResult.error;
              } else {
                editOk = false;
                editError = "Could not resolve _id from _uuid";
              }
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
          };
          await stub.fetch("https://do/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(logEntry),
          });
        })()
      );
    }
  }

  return c.text("OK", 200);
});

export default hook;
