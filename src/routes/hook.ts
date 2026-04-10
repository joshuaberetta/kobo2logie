import { Hono } from "hono";
import type { Env } from "../types.js";
import type { KoboSubmission } from "../lib/kobo.js";
import { forwardSubmission } from "../lib/forward.js";

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

  // Fire-and-forget forwarding if a URL is configured for this form
  const fwdConfig = await c.env.FORWARD_CONFIG.get(formUID);
  if (fwdConfig) {
    const { forwardUrl, forwardToken, fields, transcribe, describe, forwardMedia } = JSON.parse(fwdConfig) as {
      forwardUrl?: string;
      forwardToken?: string;
      fields?: string[];
      transcribe?: { questions: string[]; model?: string; prompt?: string };
      describe?: { questions: string[]; model?: string; prompt?: string };
      forwardMedia?: string[];
    };
    if (forwardUrl) {
      const submission = body as KoboSubmission;

      // Build a filtered payload if the user has specified a fields subset
      let jsonPayload: Record<string, unknown> | undefined;
      if (fields && fields.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const f of fields) {
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

      const openaiApiKey = c.env.OPENAI_API_KEY || undefined;

      c.executionCtx.waitUntil(
        forwardSubmission(
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
          forwardMedia || undefined
        )
      );
    }
  }

  return c.text("OK", 200);
});

export default hook;
