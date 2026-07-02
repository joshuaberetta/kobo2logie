# Plan: Backfill Un-forwarded Submissions

## Goal

Let a user push **pre-existing** Kobo submissions to the forwarding location — submissions
that were collected *before* the kobo2logie REST Service was set up (or during any window where
the hook wasn't firing), and therefore were never forwarded.

Today, data only reaches the forwarding location when Kobo's REST Service fires the webhook on a
**new** submission ([configure.ts](../src/routes/configure.ts) registers the hook;
[hook.ts](../src/routes/hook.ts) receives it). Anything already sitting in the Kobo project at setup
time is invisible to the integration.

This feature adds a new UI section that:
1. Lists Kobo submissions **not represented in the submission log** (compared by root uuid).
2. Lets the user select all, or a subset, and push them through the existing pipeline.

It builds directly on the existing retry flow ([retry.ts](../src/routes/retry.ts)), which already
does "fetch a submission from Kobo by uuid → re-POST to the hook." Backfill is the same move,
generalized to *many* submissions the user hasn't seen yet, plus a diffing step to find them.

---

## Background: how the current flow works

- **Ingest:** `POST /api/hook/:formUID` ([hook.ts:152](../src/routes/hook.ts)) receives a submission,
  relays it to the `FormSession` DO for the live feed, then in a `waitUntil` background task runs the
  full pipeline (geocode → forward → edit-back → validate → email) and writes a `LogEntry`
  ([hook.ts:642](../src/routes/hook.ts)).
- **Logs:** `LogEntry` ([types.ts:42](../src/types.ts)) carries `uuid` (the submission `_uuid`),
  `id` (`_id`), `ok`, `httpStatus`, and per-step results. Stored in the `FormSession` Durable Object
  under key `"logs"`, **newest-first, capped at `MAX_LOG = 100`** ([FormSession.ts:5,116-128](../src/FormSession.ts)).
  Read via `GET /api/logs/:formUID` ([index.ts:26](../src/index.ts)).
- **Retry:** `POST /api/retry/:formUID {uuid}` ([retry.ts:14](../src/routes/retry.ts)) fetches the
  submission from Kobo (`data.json?query={"_uuid":...}`) and re-POSTs it to the hook. No forward logic
  is duplicated — it re-drives the whole hook pipeline.
- **Kobo listing:** the Kobo endpoint `GET /api/v2/assets/{uid}/data.json` supports Mongo-style
  `query=`, `fields=`, and paging (`limit`, `start`). The repo currently only ever queries a single
  uuid; **no paged listing exists yet** — this feature introduces it.

---

## Key design decisions

### 1. The 100-log cap makes "what's in the logs" an unreliable source of truth ⚠️

The submission log is capped at 100 entries in the DO. If a project has >100 forwarded submissions,
older log entries fall off, so a naive "Kobo uuids − log uuids" diff would re-list (and risk
re-pushing) submissions that *were* already forwarded but scrolled out of the log.

**Decision:** introduce a separate, uncapped **forwarded-uuid index** in the `FormSession` DO,
distinct from the display log. This is a `Set<string>` of root uuids that have been successfully
forwarded (or at least attempted). The hook pipeline records into it whenever it writes a log entry;
the backfill diff reads from it.

- Storage key: `"forwardedUuids"` (a JSON string array, or chunked if it grows large — see Risks).
- Written in `FormSession.handleLog()` alongside the existing `logs.unshift(entry)`: add
  `entry.uuid` to the set. This means **every** processed submission (hook or retry or backfill)
  registers, going forward.
- **Caveat:** submissions forwarded *before this feature ships* won't be in the index. That's
  acceptable — the index starts populating from deploy time, and the diff also unions with the
  current in-memory log uuids so recent history is covered. For a project that already has
  everything forwarded, the first backfill listing may show false "un-forwarded" rows; the UI must
  make selection deliberate (no auto-push) and show `_submission_time` so the user can judge.
  Optionally provide a "mark all as already forwarded" action that seeds the index without pushing
  (see Optional extras).

Alternative considered: compare only against the visible log — rejected because it silently breaks
for any project with >100 submissions, which is exactly the "already has lots of data" case this
feature targets.

### 2. What is the "root uuid" to compare on?

Kobo submissions have `_uuid`. When a submission is **edited**, Kobo issues a new `_uuid` but keeps
the original in `meta/rootUuid` (formatted `uuid:<...>`). The log stores `_uuid` ([hook.ts:472](../src/routes/hook.ts)).

**Decision:** compare on `_uuid` (what the log already stores) as the primary key, since that's what
retry and the log are keyed on and it's always present. Additionally normalize/also-check
`meta/rootUuid` when present so an edited submission whose *root* was already forwarded isn't
re-listed. Implement a small helper `rootUuidOf(submission)` that returns
`(submission["meta/rootUuid"] ?? submission._uuid)` stripped of any `uuid:` prefix, and store/compare
on that normalized value consistently in both the index and the diff.

### 3. Reuse the retry mechanism, don't duplicate the pipeline

Backfill = "for each selected submission, do what retry does." We route each push through
`POST /api/hook/:formUID` (same as retry) so geocode/forward/edit/validate/email all run identically
and a log entry is produced. This keeps one pipeline, one source of behavior.

**Decision:** extract the shared "fetch submission by uuid from Kobo + re-post to hook" logic (server
resolution, token resolution, `data.json` fetch, hook re-post) out of [retry.ts](../src/routes/retry.ts)
into a small helper so both retry and backfill use it. Server allow-list and token resolution already
live there ([retry.ts:5-8,27-36](../src/routes/retry.ts)).

### 4. Throttling / batch size

Pushing hundreds of submissions must not hammer Kobo/OpenAI/the forward target or blow Worker
subrequest limits. Each hook call itself fans out to geocode/transcribe/forward/edit/validate.

**Decision:** the backfill push endpoint accepts a batch of uuids and processes them with **bounded
concurrency** (e.g. 3–5 at a time) server-side, returning a per-uuid result summary. The UI pushes in
pages and shows progress. Do **not** push all at once. Make the concurrency limit a named constant.

---

## Data flow

### Listing un-forwarded submissions

```
Client → GET /api/backfill/:formUID/pending?start=0&limit=200
  1. Resolve server + kobo read token (same as retry).
  2. Page Kobo:  GET {server}/api/v2/assets/{formUID}/data.json
                   ?fields=["_uuid","_id","_submission_time","meta/rootUuid"]
                   &sort={"_submission_time":-1}
                   &limit={limit}&start={start}
     (fields projection keeps the payload small — we only need identity + time for the list)
  3. Load forwarded-uuid index from FormSession DO (GET /forwarded-uuids).
  4. For each Kobo row, compute rootUuidOf(row); if NOT in the index → it's "pending".
  5. Return { pending: [{uuid, id, submissionTime}], nextStart, total, hasMore }.
```

The endpoint returns Kobo's `count`/paging info so the UI can page through very large projects
without loading everything at once.

### Pushing selected submissions

```
Client → POST /api/backfill/:formUID/push   body: { uuids: string[] }   (bounded page, e.g. ≤50)
  For each uuid, with concurrency ≤ N (constant):
    - fetch submission from Kobo by _uuid (shared retry helper)
    - if missing → result: {uuid, status:"not_found"}
    - else re-POST to /api/hook/:formUID  (drives full pipeline + writes LogEntry + updates index)
    - result: {uuid, status:"ok"|"hook_error", httpStatus}
  Return { results: [...] }
```

Because each push re-drives the hook, the forwarded-uuid index and the display log update as a side
effect — no extra bookkeeping needed on the push path.

---

## Implementation

### Durable Object: forwarded-uuid index — [src/FormSession.ts](../src/FormSession.ts)

- Add storage-backed set under key `"forwardedUuids"`.
- In `handleLog()` ([FormSession.ts:116](../src/FormSession.ts)): after storing the log, read the set,
  add `entry.uuid` (normalized), write back. (Guard against undefined uuid.)
- Add route `GET /forwarded-uuids` → returns `{ uuids: string[] }`.
- (Optional) Add route `POST /forwarded-uuids` with `{ uuids: string[], mode: "add" }` to seed the
  index without pushing (for the "mark as already forwarded" action).
- Consider size: 10k uuids ≈ ~400 KB as one JSON value — within DO value limits but watch growth.
  If needed later, shard by prefix; not required for v1.

### New route: [src/routes/backfill.ts](../src/routes/backfill.ts)

- `GET /:formUID/pending` — paged listing + diff (data flow above).
- `POST /:formUID/push` — bounded-concurrency batch push.
- Reuse server allow-list + `resolveKoboEditToken` + the extracted "fetch-by-uuid + re-post-to-hook"
  helper.

### Shared helper — extract from [src/routes/retry.ts](../src/routes/retry.ts)

- New `src/lib/repush.ts` (or similar) exporting e.g.
  `fetchKoboSubmissionByUuid(server, formUID, uuid, token)` and
  `repostToHook(workerOrigin, formUID, submission)`.
- Refactor `retry.ts` to call these (behavior-preserving), then `backfill.ts` reuses them.

### Mount router — [src/index.ts](../src/index.ts)

- `import backfill from "./routes/backfill.js";`
- `app.route("/api/backfill", backfill);` (add near [index.ts:23](../src/index.ts)).

### UI — new section in [src/routes/ui.ts](../src/routes/ui.ts)

Add a collapsible section on the `/:uid` page, modeled on the existing "Submission log" section
([ui.ts:648-659](../src/routes/ui.ts)) so it matches the established markup/interaction patterns:

- Header: **"Backfill submissions"** with a **"Find un-forwarded"** button (loads the pending list)
  and a subtitle explaining it lists submissions in Kobo not yet forwarded.
- A table of pending rows: checkbox | Submission time | Submission ID (`uuid.slice(0,8)…` with full
  in `title`, matching the log table's [ui.ts:1889](../src/routes/ui.ts)) | status.
- **Select all / Deselect all** controls (reuse the `.select-btn` styling already used for fields at
  [ui.ts:641-642](../src/routes/ui.ts)).
- **Push selected** button → posts uuids in pages of ≤50 to `/api/backfill/:formUID/push`, shows a
  progress indicator, disables during the run, and updates each row's status from the results.
- **Pagination** for the pending list (Kobo `start`/`limit`), mirroring `loadMoreLogs()`
  ([ui.ts:1905](../src/routes/ui.ts)).
- On completion, refresh the submission log (`refreshLogs(true)`) so the new forward attempts appear.
- All JS inline in the page script, consistent with the existing `retrySubmission()`/`refreshLogs()`
  functions.

---

## Edge cases

| Case | Handling |
|---|---|
| Project already fully forwarded, but index empty (pre-feature data) | Listing may show false "pending" rows. UI never auto-pushes; shows submission time; offer "mark as already forwarded" to seed the index. |
| >100 forwarded submissions (log cap) | Diff uses the uncapped forwarded-uuid index, not the display log — the whole point of decision #1. |
| Edited submissions (new `_uuid`, same `meta/rootUuid`) | Normalize on `rootUuidOf()` so an edited submission whose root was forwarded isn't re-listed. |
| Submission deleted from Kobo between list and push | Push returns `not_found` for that uuid; surfaced per-row; no crash. |
| Very large project (thousands) | Paged listing (`start`/`limit`); push in bounded pages with bounded concurrency. Log what isn't loaded rather than implying full coverage. |
| Duplicate push (user pushes same row twice) | Re-drives hook again → forwards again. Same semantics as existing retry; acceptable. Once forwarded, the row leaves the pending list on next "Find un-forwarded". |
| No forward config for the form | 404, same as retry ([retry.ts:22-25](../src/routes/retry.ts)). |
| Kobo listing fails (auth/5xx) | Return 502 with status, surface in UI (mirror retry's error handling [retry.ts:45-49](../src/routes/retry.ts)). |
| Concurrency/subrequest limits (Cloudflare) | Bounded concurrency constant + client-side paging keeps each request's subrequest fan-out in check. |

---

## Files to change

| File | Change |
|---|---|
| [src/FormSession.ts](../src/FormSession.ts) | Forwarded-uuid index: update in `handleLog()`, add `GET /forwarded-uuids` (+ optional `POST`). |
| [src/lib/repush.ts](../src/lib/repush.ts) *(new)* | Shared "fetch submission by uuid + re-post to hook" + `rootUuidOf()` helper. |
| [src/routes/retry.ts](../src/routes/retry.ts) | Refactor to use the shared helper (behavior-preserving). |
| [src/routes/backfill.ts](../src/routes/backfill.ts) *(new)* | `GET /:formUID/pending` (list+diff) and `POST /:formUID/push` (batch push). |
| [src/index.ts](../src/index.ts) | Mount `/api/backfill`. |
| [src/routes/ui.ts](../src/routes/ui.ts) | New "Backfill submissions" section + inline JS. |
| [src/types.ts](../src/types.ts) | Any shared types for pending-list / push-result payloads. |

---

## Out of scope (v1)

- Automatic/scheduled backfill (cron). This is user-initiated only.
- Selective per-step re-run (e.g. forward-only without re-validating). Backfill re-drives the full
  hook pipeline, same as retry.
- Retroactively seeding the forwarded-uuid index from Kobo's edit history.

---

## Optional extras (nice-to-have)

- **"Mark as already forwarded"** button on pending rows → seeds the index (`POST /forwarded-uuids`)
  without pushing, for cleaning up false positives on pre-existing data.
- Show a **count badge** ("N un-forwarded") on the section header, like the fields count
  ([ui.ts:640](../src/routes/ui.ts)).
- **Filter** the pending list by submission-time range before pushing.
