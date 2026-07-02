import type { KoboSubmission } from "./kobo.js";

/**
 * The set of Kobo servers a form config is allowed to reference. Any other
 * value falls back to DEFAULT_KOBO_BASE_URL. Shared by the retry and backfill
 * routes.
 */
export const ALLOWED_SERVERS = new Set([
  "https://kf.kobotoolbox.org",
  "https://eu.kobotoolbox.org",
]);

/**
 * Resolves the effective Kobo server for a form config, restricted to the
 * allow-list, falling back to the default base URL.
 */
export function resolveServer(configServer: string | undefined, defaultServer: string): string {
  return configServer && ALLOWED_SERVERS.has(configServer) ? configServer : defaultServer;
}

/**
 * Returns the normalized root uuid for a submission — the value used to decide
 * whether a submission has already been forwarded.
 *
 * Kobo issues a fresh `_uuid` when a submission is edited but preserves the
 * original in `meta/rootUuid` (formatted `uuid:<...>`). We normalize on the
 * root so an edited submission whose root was already forwarded isn't treated
 * as new. The `uuid:` prefix is stripped for consistent comparison.
 */
export function rootUuidOf(submission: Record<string, unknown>): string | undefined {
  const root = submission["meta/rootUuid"] ?? submission["_uuid"];
  if (typeof root !== "string" || !root) return undefined;
  return root.replace(/^uuid:/, "");
}

/**
 * Fetches a single submission from Kobo by its `_uuid`. Returns the submission
 * object, or null when not found. Throws on transport / non-OK HTTP so callers
 * can distinguish "not found" from "Kobo error".
 */
export async function fetchKoboSubmissionByUuid(
  server: string,
  formUID: string,
  uuid: string,
  token: string
): Promise<KoboSubmission | null> {
  const query = JSON.stringify({ _uuid: uuid.trim() });
  const url = `${server}/api/v2/assets/${formUID}/data.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kobo fetch failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const data = await res.json<{ results?: KoboSubmission[] }>();
  return data.results?.[0] ?? null;
}

/**
 * Re-drives the full hook pipeline for a submission by POSTing it to the hook
 * endpoint, exactly as if Kobo's REST Service had delivered it. Returns the
 * hook response so callers can surface the HTTP status.
 *
 * The request is dispatched through the worker's SELF service binding rather
 * than a plain `fetch` to the public hostname. A subrequest to the worker's own
 * zone is routed to the origin (which doesn't exist for a Worker-only zone) and
 * times out with a 522 — the service binding re-invokes this worker in-process
 * instead, with no network hop.
 */
export async function repostToHook(
  self: Fetcher,
  formUID: string,
  submission: KoboSubmission | Record<string, unknown>
): Promise<Response> {
  // Host is ignored by the service binding; only the path routes within the worker.
  const hookUrl = `https://self/api/hook/${formUID}`;
  return self.fetch(hookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
}
