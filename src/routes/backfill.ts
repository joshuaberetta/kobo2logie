import { Hono } from "hono";
import type { Env } from "../types.js";
import { resolveKoboEditToken } from "../lib/koboEdit.js";
import { fetchKoboSubmissionByUuid, repostToHook, resolveServer, rootUuidOf } from "../lib/repush.js";

const backfill = new Hono<{ Bindings: Env }>();

// How many submissions to fetch+push concurrently. Each push re-drives the full
// hook pipeline (geocode/transcribe/forward/edit/validate), which itself fans
// out to several subrequests — keep this low to stay within Worker limits and
// avoid hammering Kobo / the forward target.
const PUSH_CONCURRENCY = 3;

// Max uuids accepted in a single push request. The UI pages larger selections.
const MAX_PUSH_BATCH = 50;

// Default page size for listing submissions from Kobo.
const DEFAULT_LIST_LIMIT = 200;

function getForwardedUuids(env: Env, formUID: string): Promise<Set<string>> {
  const id = env.FORM_SESSION.idFromName(formUID);
  const stub = env.FORM_SESSION.get(id);
  return stub
    .fetch("https://do/forwarded-uuids")
    .then((r) => r.json<{ uuids?: string[] }>())
    .then((d) => new Set(d.uuids ?? []));
}

// ── GET /api/backfill/:formUID/pending ────────────────────────────────────────
// Lists submissions in the Kobo project that are not present in the forwarded-
// uuid index (compared on normalized root uuid). Paged via start/limit.

backfill.get("/:formUID/pending", async (c) => {
  const formUID = c.req.param("formUID");
  const start = Math.max(0, parseInt(c.req.query("start") ?? "0", 10) || 0);
  const limit = Math.min(
    500,
    Math.max(1, parseInt(c.req.query("limit") ?? String(DEFAULT_LIST_LIMIT), 10) || DEFAULT_LIST_LIMIT)
  );

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

  // Fetch a page of submissions, projecting only the identity + time fields.
  const fields = JSON.stringify(["_uuid", "_id", "_submission_time", "meta/rootUuid"]);
  const sort = JSON.stringify({ _submission_time: -1 });
  const koboUrl =
    `${server}/api/v2/assets/${formUID}/data.json` +
    `?fields=${encodeURIComponent(fields)}` +
    `&sort=${encodeURIComponent(sort)}` +
    `&limit=${limit}&start=${start}`;

  let koboRes: Response;
  try {
    koboRes = await fetch(koboUrl, { headers: { Authorization: `Token ${koboToken}` } });
  } catch (err) {
    console.error(`[backfill] Kobo list failed: ${err}`);
    return c.json({ error: `Failed to list submissions from Kobo: ${err}` }, 502);
  }
  if (!koboRes.ok) {
    const text = await koboRes.text().catch(() => "");
    console.error(`[backfill] Kobo list HTTP ${koboRes.status} — ${text.slice(0, 200)}`);
    return c.json({ error: `Failed to list submissions from Kobo: HTTP ${koboRes.status}` }, 502);
  }

  const data = await koboRes.json<{
    count?: number;
    results?: Array<Record<string, unknown>>;
  }>();
  const results = data.results ?? [];

  const forwarded = await getForwardedUuids(c.env, formUID);

  const pending = results
    .map((row) => {
      const root = rootUuidOf(row);
      return {
        uuid: typeof row._uuid === "string" ? row._uuid : "",
        root,
        id: typeof row._id === "number" ? row._id : undefined,
        submissionTime: typeof row._submission_time === "string" ? row._submission_time : undefined,
      };
    })
    .filter((r) => r.uuid && r.root && !forwarded.has(r.root))
    .map(({ uuid, id, submissionTime }) => ({ uuid, id, submissionTime }));

  const hasMore = results.length === limit;
  return c.json({
    pending,
    nextStart: start + results.length,
    hasMore,
    total: data.count,
    pageSize: results.length,
  });
});

// ── POST /api/backfill/:formUID/push ──────────────────────────────────────────
// Pushes a batch of submissions (by _uuid) through the hook pipeline with
// bounded concurrency. Returns a per-uuid result summary.

backfill.post("/:formUID/push", async (c) => {
  const formUID = c.req.param("formUID");

  const body = await c.req.json<{ uuids?: string[] }>().catch(() => ({}) as { uuids?: string[] });
  const uuids = (Array.isArray(body.uuids) ? body.uuids : []).filter(
    (u): u is string => typeof u === "string" && !!u.trim()
  );
  if (uuids.length === 0) {
    return c.json({ error: "uuids is required" }, 400);
  }
  if (uuids.length > MAX_PUSH_BATCH) {
    return c.json({ error: `Too many uuids (max ${MAX_PUSH_BATCH} per request)` }, 400);
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

  type PushResult = { uuid: string; status: "ok" | "not_found" | "error"; httpStatus?: number; error?: string };

  async function pushOne(uuid: string): Promise<PushResult> {
    try {
      const submission = await fetchKoboSubmissionByUuid(server, formUID, uuid, koboToken);
      if (!submission) {
        console.error(`[backfill] push ${uuid}: submission not found in Kobo`);
        return { uuid, status: "not_found" };
      }
      const hookRes = await repostToHook(c.env.SELF, formUID, submission);
      if (!hookRes.ok) {
        const text = await hookRes.text().catch(() => "");
        console.error(`[backfill] push ${uuid}: hook returned HTTP ${hookRes.status} — ${text.slice(0, 300)}`);
        return { uuid, status: "error", httpStatus: hookRes.status, error: text.slice(0, 300) || `HTTP ${hookRes.status}` };
      }
      return { uuid, status: "ok", httpStatus: hookRes.status };
    } catch (err) {
      console.error(`[backfill] push ${uuid} threw: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      return { uuid, status: "error", error: String(err) };
    }
  }

  // Process with bounded concurrency, preserving input order in the results.
  const results: PushResult[] = new Array(uuids.length);
  let cursor = 0;
  async function worker() {
    while (cursor < uuids.length) {
      const i = cursor++;
      results[i] = await pushOne(uuids[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PUSH_CONCURRENCY, uuids.length) }, () => worker())
  );

  return c.json({ results });
});

export default backfill;
