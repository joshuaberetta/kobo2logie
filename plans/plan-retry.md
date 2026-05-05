# Plan: Retry Failed Submissions

## Goal

Add a "Retry" button to failed log entries that re-runs the full hook pipeline for that submission without requiring the original webhook payload to be stored.

---

## How it works

When a submission is shown as **Failed** in the log, we have its `_uuid` (and usually `_id`) stored in the log entry. We can:

1. Re-fetch the full submission JSON from KoboToolbox using the `_uuid`
2. POST it to the existing hook handler as if it were a fresh webhook delivery

This means no new pipeline logic — the existing `POST /api/hook/:formUID` handler runs unchanged.

---

## Data flow

### 1. Fetch submission from KoboToolbox

Use the `_uuid` from the log entry to retrieve the full submission:

```
GET https://{server}/api/v2/assets/{formUID}/data.json
  ?query={"_uuid":"<uuid>"}
Authorization: Token {koboToken}
```

Response shape:
```json
{
  "results": [
    {
      "_uuid": "...",
      "_id": 123,
      "_submission_time": "...",
      "field_name": "value",
      ...
    }
  ]
}
```

The `server` and `koboToken` are both available from the form's fwdConfig in KV.

### 2. Re-drive the hook pipeline

Take `results[0]` and POST it to the hook endpoint:

```
POST /api/hook/:formUID
Content-Type: application/json

{ ...submissionData }
```

This re-runs geocoding, forward, edit, validate, email — everything — exactly as if the webhook fired again.

---

## Implementation

### New API route: `POST /api/retry/:formUID`

Add to `src/routes/configure.ts` (or a new `retry.ts`):

```
POST /api/retry/:formUID
Body: { uuid: string }
```

Handler logic:
1. Read `fwdConfig` from KV for `formUID`
2. Resolve the Kobo server and token from config + env
3. Fetch submission from KoboToolbox `/api/v2/assets/{formUID}/data.json?query={"_uuid":"<uuid>"}`
4. If no results → 404
5. Extract `results[0]` as the submission payload
6. Internally invoke the hook pipeline (or just re-POST to `/api/hook/:formUID`) with the fetched payload

**Token resolution**: The KoboToolbox read token is the same one used for `resolveSubmissionId` in hook.ts — pulled from `KOBO_API_TOKEN_GLOBAL` / `KOBO_API_TOKEN_EU` env vars, selected by server hostname via `resolveKoboEditToken()`.

### UI: Add "Retry" button to failed rows

In `renderLogRows()` in `src/routes/ui.ts`:

- For entries where `e.ok === false`, render a retry button alongside the existing Details button
- On click, call `retrySubmission(idx)`

```js
async function retrySubmission(idx) {
  const e = logEntries[idx];
  if (!e?.uuid) return;
  // disable button, show spinner
  const res = await fetch('/api/retry/' + UID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: e.uuid })
  });
  if (res.ok) {
    // wait a beat then refresh logs so the new attempt appears
    setTimeout(() => refreshLogs(true), 1500);
  } else {
    alert('Retry failed: ' + res.status);
  }
}
```

---

## Edge cases

| Case | Handling |
|---|---|
| Submission deleted from Kobo | `/data.json` returns empty `results` → 404 response, show error in UI |
| No `_uuid` on log entry (old entries) | Hide retry button; button is only shown when `e.uuid` is present |
| Retry itself fails | A new log entry is written by the hook pipeline — user can see the new failure in the log |
| Retry of a partially-failed submission (e.g. forward OK, email failed) | Full pipeline re-runs; forward will fire again. This is acceptable for now — a full re-run is simpler than selective step retry |
| Rate limits / 429 | Hook handler already logs these; the retry attempt will produce its own log entry |

---

## Files to change

| File | Change |
|---|---|
| `src/routes/configure.ts` (or new `src/routes/retry.ts`) | New `POST /api/retry/:formUID` route |
| `src/index.ts` | Mount retry router |
| `src/routes/ui.ts` | Add retry button to failed log rows + `retrySubmission()` JS function |

---

## What we do NOT need to store

- The original webhook payload
- Media file contents (re-fetched from Kobo during forward, same as the first attempt)
- Any intermediate state

The only thing required from the log entry is `_uuid`.
