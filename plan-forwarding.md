# Plan: Per-Form Middleware Forwarding with Media Fetch

**TL;DR:** When a submission hits `/api/hook/:formUID`, if that form has a forwarding URL configured, fire-and-forget a `multipart/form-data` POST to the external service containing the submission JSON + fetched binary images. The external service receives everything it needs — zero Kobo access required.

Format: **multipart/form-data** — avoids ~33% base64 size overhead and is directly usable by most HTTP clients/frameworks without decoding.

---

## Phase 1 — Infrastructure

1. Add a `FORWARD_CONFIG` KV namespace binding to `wrangler.toml` (create with `wrangler kv:namespace create FORWARD_CONFIG`)
2. Add two Wrangler secrets for the `wfp_logie` token, one per server:
   - `wrangler secret put KOBO_API_TOKEN_GLOBAL` — for `https://kf.kobotoolbox.org`
   - `wrangler secret put KOBO_API_TOKEN_EU` — for `https://eu.kobotoolbox.org`
3. Update `src/types.ts` `Env` interface: add `FORWARD_CONFIG: KVNamespace`, `KOBO_API_TOKEN_GLOBAL: string`, and `KOBO_API_TOKEN_EU: string`

## Phase 2 — Forwarding URL Persistence

4. Add `POST /api/configure/forward` in `src/routes/configure.ts`:
   - Body: `{ uid, forwardUrl }` — validates `forwardUrl` is HTTPS (or empty string to clear)
   - Writes `JSON.stringify({ forwardUrl })` to `FORWARD_CONFIG` KV under key `uid`
   - Returns 200 JSON `{ ok: true }`
5. Register the route in `src/index.ts`

## Phase 3 — Configure Page UI *(parallel with Phase 2)*

6. Extend the configure page in `src/routes/ui.ts`:
   - Add optional "Forwarding URL" input + "Set forwarding" button below the existing fields
   - Calls `POST /api/configure/forward`, shows inline success/error (same pattern as existing buttons)
   - Field is optional — leaving it blank clears any existing config

## Phase 4 — Kobo Utility Additions

7. Add to `src/lib/kobo.ts`:
   - `submissionImageFilenames(submission)` — walks all non-`_attachments` values in the flat submission JSON, returns a `Set<string>` of all string values
   - `imageAttachmentsToForward(submission)` — filters `_attachments` to non-deleted images whose `media_file_basename` is in that Set (handles the case where the REST service strips some question fields)

## Phase 5 — Forward Function *(depends on Phase 4)*

8. Create new `src/lib/forward.ts` with `forwardSubmission(submission, forwardUrl, koboToken, koboBaseUrl)`:
   - Calls `imageAttachmentsToForward` to get only the relevant images
   - Resolves the correct token from `KOBO_API_TOKEN_GLOBAL` or `KOBO_API_TOKEN_EU` based on whether `koboBaseUrl` matches the EU server hostname
   - Fetches each image from Kobo using `Authorization: Token {resolvedToken}` on `download_url`
   - Builds a `FormData`: part `submission` = JSON string, one `File` part per image (correct mimetype + filename)
   - POSTs `FormData` to `forwardUrl`
   - Errors caught and logged via `console.error` — never throws (fire-and-forget safe)

## Phase 6 — Hook Integration *(depends on Phases 1, 5)*

9. In `src/routes/hook.ts`, after the successful DO relay:
   - `await env.FORWARD_CONFIG.get(formUID)` — parse `forwardUrl`
   - If present: `c.executionCtx.waitUntil(forwardSubmission(submission, forwardUrl, env.DEFAULT_KOBO_BASE_URL, { global: env.KOBO_API_TOKEN_GLOBAL, eu: env.KOBO_API_TOKEN_EU }))`
   - Hook still returns 200 to Kobo immediately

---

## Files Changed

| File | Change |
|---|---|
| `wrangler.toml` | Add KV namespace binding |
| `src/types.ts` | Add `FORWARD_CONFIG`, `KOBO_API_TOKEN_GLOBAL`, `KOBO_API_TOKEN_EU` to `Env` |
| `src/routes/configure.ts` | New `POST /api/configure/forward` handler |
| `src/routes/ui.ts` | Forwarding URL field on configure page |
| `src/lib/kobo.ts` | `submissionImageFilenames`, `imageAttachmentsToForward` |
| `src/lib/forward.ts` | **New file** — `forwardSubmission` |
| `src/routes/hook.ts` | KV lookup + `waitUntil` call |
| `src/index.ts` | Route registration |

---

## Verification

### Setup

Use [webhook.site](https://webhook.site) as the forwarding target — it gives a free HTTPS URL that displays incoming multipart requests including part names, binary file names, and headers. No infrastructure needed; the Worker under `wrangler dev` can reach it directly.

### Steps

1. `npm run dev` — no TypeScript errors; KV is emulated locally by Wrangler
2. Set a forwarding URL for a test form:
   ```bash
   curl -X POST http://localhost:8787/api/configure/forward \
     -H "Content-Type: application/json" \
     -d '{"uid":"TESTUID","forwardUrl":"https://webhook.site/your-uuid"}'
   ```
3. Send a test submission:
   ```bash
   curl -X POST http://localhost:8787/api/hook/TESTUID \
     -H "Content-Type: application/json" \
     -d @payload.json
   ```
4. On webhook.site, verify the captured request shows:
   - `Content-Type: multipart/form-data` with a boundary
   - A `submission` part containing the full JSON string
   - One `File` part per expected image with correct filename and mimetype
   - Images whose `media_file_basename` does **not** appear in the submission body are absent
5. **Verify unchanged behaviour:** use a different `formUID` with no forwarding config — WS broadcast fires normally and nothing arrives at webhook.site

### Notes on `payload.json` / `payload2.json`

Check whether the existing test payloads contain real `download_url` values in `_attachments`. If the URLs are real Kobo URLs the Worker will fetch them using the configured token. If they are placeholders, the image fetch will fail silently (logged to console) but the `submission` JSON part should still arrive. Edit in a real `download_url` for a test attachment if needed to exercise the image path.

---

## Scope / Decisions

- **No auth header** on the forwarded request
- **No retry logic** on forward failure — errors are logged only
- **Non-image attachments excluded** (audio, video, docs)
- **Forwarding URL is write-only** in the UI for now (no read-back to pre-populate the field)
