# Plan: Edit Original Submission

## Goal

Add a toggle in Advanced Settings — **"Edit original submission"** — that, when enabled, writes computed enrichment values back to the original KoboToolbox submission after processing. This closes the loop: Kobo itself ends up holding the enriched data (transcripts, descriptions, appended fields).

---

## Two-step Kobo API flow

### Step 1 — Resolve `_id` from `_uuid`

The webhook payload always contains `_uuid` but the Kobo bulk-edit API requires `_id`. Fetch it with a filtered data query:

```
GET {server}/api/v2/assets/{uid}/data.json
  ?query={"_uuid":"{uuid}"}
  &fields=["_id"]

Authorization: Token {serverToken}
```

Response:
```json
{
  "count": 1,
  "results": [{ "_id": 722126510, "_uuid": "25467266-df68-..." }]
}
```

Extract `results[0]._id`.

### Step 2 — Patch the submission

```
PATCH {server}/api/v2/assets/{uid}/data/bulk/

Authorization: Token {serverToken}
Content-Type: application/json

{
  "payload": "{\"submission_ids\":[722126510],\"data\":{\"xpath/to/field\":\"value\"}}"
}
```

Note: the `payload` value is a **JSON-stringified string** (double-encoded), matching the pattern in the Kobo Python client.

---

## What gets written back

Only JSON field values are written back — no binary files are ever uploaded to Kobo.

| Source | Written as |
|---|---|
| `appendValues` pairs | `key → value` written as flat fields (no `_metadata` wrapper — keys are question xpaths) |
| Transcription results | `{questionXpath}_transcript → "text…"` |
| Image description results | `{questionXpath}_description → "text…"` |

All three are merged into a single `data` object and sent in one PATCH request (one round trip).

If no enrichment data exists (e.g. no transcription ran, no appendValues set), the edit step is skipped entirely.

---

## Config changes

### `FORWARD_CONFIG` KV value

Add one new boolean field:

```json
{
  "editOriginal": true
}
```

### `GET /api/configure/project/:uid` response

Include `editOriginal` in the returned JSON:

```json
{ "editOriginal": false }
```

### `POST /api/configure/project/:uid` body

Accept and persist `editOriginal`:

```json
{ "editOriginal": true }
```

---

## Hook pipeline changes (`src/routes/hook.ts`)

The edit runs **after** transcription and description complete (both are already awaited during the forward step). The new step:

1. Check if `editOriginal === true` in the config and a `server` is stored
2. Build the `data` object:
   - Spread `appendValues` entries → `{ [key]: value }` (strip `_uuid` if present)
   - Add any transcript results → `{ [xpath + "_transcript"]: "…" }`
   - Add any description results → `{ [xpath + "_description"]: "…" }`
   - Remove `_uuid` from the final `data` object before sending (it is a system field and must not be written back)
3. If `data` is empty, skip
4. Resolve `_id` from `_uuid` via Step 1 above
5. PATCH via Step 2 above
6. Write a log entry for the edit result

The server token is picked the same way as the survey proxy:
- `eu.kobotoolbox.org` → `KOBO_API_TOKEN_EU`
- anything else → `KOBO_API_TOKEN_GLOBAL`

---

## Submission log changes

### New log entry type

Add an `editOk` and `editError` field to `LogEntry` in `src/types.ts`:

```ts
export interface LogEntry {
  // …existing fields…
  editOk?: boolean;        // true = edit succeeded, false = failed, undefined = not attempted
  editHttpStatus?: number; // HTTP status from the Kobo bulk-edit endpoint
  editError?: string;      // error message if edit failed
}
```

### Log table column

Add an **Edit** column next to the existing Status column:

| Time | Submission ID | Fwd Status | Edit | HTTP | |
|---|---|---|---|---|---|
| Apr 11 14:32 | 25467266… | ✓ OK | ✓ OK | 200 | Details |
| Apr 11 14:01 | 9a3bcdef… | ✓ OK | — | 200 | Details |

- `✓ OK` — edit succeeded
- `✗ Fail` — edit attempted but failed
- `—` — edit not configured or no data to write

### Detail modal

Add rows in the existing modal:

- **Edit result**: `✓ Written back` / `✗ Failed` / `—`
- **Edit HTTP**: (if attempted)
- **Edit error**: (if failed)

---

## UI changes (`src/routes/ui.ts`, `/:uid` page)

### Advanced Settings — new toggle

Add below the "Forward media types" block inside `.advanced-body`:

```html
<div>
  <label class="checkbox-row">
    <input type="checkbox" id="edit-original" />
    <span>Edit original submission</span>
  </label>
  <p class="label-hint" style="margin-top:.3rem;margin-left:1.5rem">
    Write computed values (transcripts, descriptions, appended fields) back to the original KoboToolbox submission after forwarding.
    Requires the API token configured during setup.
  </p>
</div>
```

### `loadConfig()`

Read and apply `editOriginal`:

```js
document.getElementById('edit-original').checked = !!data.editOriginal;
```

### `save()`

Include `editOriginal` in the POST body:

```js
const editOriginal = document.getElementById('edit-original').checked;
// …
body: JSON.stringify({ …, editOriginal }),
```

---

## New helper: `src/lib/koboEdit.ts`

Extract the two API calls into a dedicated module to keep `hook.ts` readable:

```ts
// Resolves the numeric _id for a submission identified by _uuid.
export async function resolveSubmissionId(
  server: string, uid: string, uuid: string, token: string
): Promise<number | null>

// Patches a set of field values onto an existing submission.
export async function editSubmission(
  server: string, uid: string, id: number,
  data: Record<string, string>, token: string
): Promise<{ ok: boolean; httpStatus: number; error?: string }>
```

---

## Files changed

| File | Change |
|---|---|
| `src/types.ts` | Add `editOk?`, `editHttpStatus?`, `editError?` to `LogEntry` |
| `src/lib/koboEdit.ts` | **New** — `resolveSubmissionId()` + `editSubmission()` helpers |
| `src/routes/configure.ts` | Accept + persist `editOriginal` in GET/POST `/project/:uid` |
| `src/routes/hook.ts` | After enrichment step: build edit payload, call helpers, log result |
| `src/routes/ui.ts` | Toggle checkbox in Advanced Settings; load/save; Edit column + modal rows in log |

---

## Sequence diagram

```
Kobo → POST /api/hook/:uid
         │
         ├─ push to DO (real-time viewer) — unchanged
         │
         ├─ forwardSubmission() — transcribe, describe, append, forward
         │        │
         │        └─ returns { transcripts, descriptions }
         │
         └─ if editOriginal && server && any data to write:
               │
               ├─ resolveSubmissionId(server, uid, uuid, token)
               │        GET /data.json?query={"_uuid":"…"}&fields=["_id"]
               │
               └─ editSubmission(server, uid, id, data, token)
                        PATCH /data/bulk/
                        log result → FORWARD_CONFIG log
```

---

## Out of scope (future)

- Letting the user configure a custom field-to-xpath mapping for write-back
- Partial write-back (skip transcripts, only write appendValues)
- Retry logic for failed edits
