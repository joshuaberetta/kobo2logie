import { Hono } from "hono";
import type { Env } from "../types.js";
import { resolveKoboEditToken } from "../lib/koboEdit.js";
import { fetchKoboSubmissionByUuid, repostToHook, resolveServer } from "../lib/repush.js";

const retry = new Hono<{ Bindings: Env }>();

// ── POST /api/retry/:formUID ──────────────────────────────────────────────────

retry.post("/:formUID", async (c) => {
  const formUID = c.req.param("formUID");

  const { uuid } = await c.req.json<{ uuid: string }>();
  if (!uuid || typeof uuid !== "string" || !uuid.trim()) {
    return c.json({ error: "uuid is required" }, 400);
  }

  const fwdConfigRaw = await c.env.FORWARD_CONFIG.get(formUID);
  if (!fwdConfigRaw) {
    return c.json({ error: "No config found for this form" }, 404);
  }

  const config = JSON.parse(fwdConfigRaw) as { server?: string };
  const server = resolveServer(config.server, c.env.DEFAULT_KOBO_BASE_URL);

  const koboToken = resolveKoboEditToken(server, {
    global: c.env.KOBO_API_TOKEN_GLOBAL,
    eu: c.env.KOBO_API_TOKEN_EU,
  });

  // Fetch the original submission from KoboToolbox by _uuid
  let submission;
  try {
    submission = await fetchKoboSubmissionByUuid(server, formUID, uuid, koboToken);
  } catch (err) {
    console.error(`[retry] ${err}`);
    return c.json({ error: `Failed to fetch submission from Kobo: ${err}` }, 502);
  }
  if (!submission) {
    return c.json({ error: "Submission not found in Kobo" }, 404);
  }

  // Re-drive the hook pipeline by posting to the hook endpoint
  const workerOrigin = new URL(c.req.url).origin;
  const hookRes = await repostToHook(workerOrigin, formUID, submission);

  if (!hookRes.ok) {
    return c.json({ error: `Hook pipeline returned HTTP ${hookRes.status}` }, 502);
  }

  return c.json({ ok: true });
});

export default retry;
