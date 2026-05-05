import { Hono } from "hono";
import type { Env } from "../types.js";
import { resolveKoboEditToken } from "../lib/koboEdit.js";

const ALLOWED_SERVERS = new Set([
  "https://kf.kobotoolbox.org",
  "https://eu.kobotoolbox.org",
]);

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
  const server =
    config.server && ALLOWED_SERVERS.has(config.server)
      ? config.server
      : c.env.DEFAULT_KOBO_BASE_URL;

  const koboToken = resolveKoboEditToken(server, {
    global: c.env.KOBO_API_TOKEN_GLOBAL,
    eu: c.env.KOBO_API_TOKEN_EU,
  });

  // Fetch the original submission from KoboToolbox by _uuid
  const query = JSON.stringify({ _uuid: uuid.trim() });
  const koboUrl = `${server}/api/v2/assets/${formUID}/data.json?query=${encodeURIComponent(query)}`;
  const koboRes = await fetch(koboUrl, {
    headers: { Authorization: `Token ${koboToken}` },
  });

  if (!koboRes.ok) {
    const text = await koboRes.text().catch(() => "");
    console.error(`[retry] Kobo fetch failed: HTTP ${koboRes.status} — ${text.slice(0, 200)}`);
    return c.json({ error: `Failed to fetch submission from Kobo: HTTP ${koboRes.status}` }, 502);
  }

  const data = await koboRes.json<{ results?: unknown[] }>();
  const submission = data.results?.[0];
  if (!submission) {
    return c.json({ error: "Submission not found in Kobo" }, 404);
  }

  // Re-drive the hook pipeline by posting to the hook endpoint
  const workerOrigin = new URL(c.req.url).origin;
  const hookUrl = `${workerOrigin}/api/hook/${formUID}`;
  const hookRes = await fetch(hookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });

  if (!hookRes.ok) {
    return c.json({ error: `Hook pipeline returned HTTP ${hookRes.status}` }, 502);
  }

  return c.json({ ok: true });
});

export default retry;
