# Plan: GitHub Issues as a Case Management Backend

**TL;DR:** When a Kobo submission is forwarded, kobo2logie creates a GitHub Issue containing all enriched data. The Issue number and URL are written back to Kobo fields via the existing edit-back pipeline. A GitHub Actions workflow on `issues: [closed]` / `issues: [reopened]` PATCHes the Kobo validation status to `approved` / `on_hold` — closing the loop without any new infrastructure.

---

## Overview of the full loop

```
Kobo → POST /api/hook/:formUID
         → forwardSubmission() → POST https://api.github.com/repos/{owner}/{repo}/issues
                                    → Issue #42 created
         ← { number: 42, html_url: "https://github.com/..." }
         → response field injection → editSubmission() → writes ticket_id + ticket_url to Kobo

GitHub user closes Issue #42
  → GA workflow: issues [closed]
    → curl Kobo API → PATCH validation_status = approved

GitHub user reopens Issue #42
  → GA workflow: issues [reopened]
    → curl Kobo API → PATCH validation_status = on_hold
```

---

## What needs to be built

This feature depends on two independently shippable pieces:

### Piece A — Response field injection (kobo2logie side)
### Piece B — GitHub Actions workflow (in the target repo)

They can be developed in parallel but both are required for the full loop.

---

## Piece A — Response field injection

### A1 — Config schema additions

Extend the per-form config stored in `FORWARD_CONFIG` KV with:

```ts
responseFieldMap?: Array<{ responsePath: string; koboField: string }>;
```

`responsePath` is a dot-notation path into the response JSON (e.g. `"number"`, `"html_url"`).  
`koboField` is the Kobo question xpath to write the value into (e.g. `"ticket_id"`, `"ticket_url"`).

No other config keys change. The existing `editOriginal` + `server` keys already control whether edit-back runs; response injection feeds into the same edit call.

### A2 — Config UI additions

In `src/routes/configure.ts` / `src/routes/ui.ts`, add a new section on the configure page:

- **Response field mappings** — a repeating row of two inputs: `Response path` + `Kobo field`. Add/remove rows (same UX pattern as existing prompt fields).
- The section is only shown when a `forwardUrl` is set, since it only makes sense with forwarding enabled.
- Saved via the existing `POST /api/configure` endpoint by including `responseFieldMap` in the body.

### A3 — Injection logic in `hook.ts`

After `forwardSubmission()` returns a `fwdResult` with `responseBody`, and when `responseFieldMap` is configured:

1. Parse `fwdResult.responseBody` as JSON (guard: skip if parse fails or body is absent).
2. For each `{ responsePath, koboField }` entry:
   - Walk the parsed object using `responsePath` split on `.` (simple path resolution, no array indexing needed for GitHub's flat response).
   - If a value is found and is a string or number, add `koboField: String(value)` to `editData`.
3. The injection merges into the same `editData` object that `editOriginal` already builds, so it flows into the single existing `editSubmission()` call — no second PATCH is needed.

Key constraint: response injection requires `editOriginal: true` and `server` to be set in the config, because those are the prerequisites for the edit-back call. Document this clearly in the UI.

### A4 — Issue body template (metadata footer)

When the forwarding target is GitHub Issues, the issue body must contain a machine-readable footer that the GA workflow can parse back:

```
<!-- kobo-meta: {"server":"https://kf.kobotoolbox.org","uid":"aXyzFormUID","uuid":"abc-123-def-456"} -->
```

This is injected by the GitHub Issues adapter (see Piece B). kobo2logie itself does not know it's talking to GitHub — it just forwards the payload and maps the response fields. The metadata footer is the adapter's responsibility.

---

## Piece B — GitHub Issues adapter + GA workflow

### B1 — GitHub Issues adapter

kobo2logie's `forwardUrl` must point to an HTTP endpoint that accepts the multipart/form-data payload and creates a GitHub Issue. Two options:

**Option 1 — GitHub Actions `workflow_dispatch` as the adapter (simplest)**  
Point `forwardUrl` at a `workflow_dispatch` trigger endpoint. A GA workflow receives the submission JSON as an input, formats it into an issue body, and calls `gh issue create`. No external server needed — everything runs in GA.

**Option 2 — Thin Cloudflare Worker adapter (recommended)**  
A separate small Worker (or a new route on kobo2logie itself) that:
1. Accepts `multipart/form-data` with a `submission` JSON part
2. Formats the issue body (markdown table of fields + metadata footer)
3. POSTs to `https://api.github.com/repos/{owner}/{repo}/issues` using a stored GitHub PAT
4. Returns the GitHub API response JSON directly — kobo2logie's response injection then maps `number` and `html_url`

Option 2 is recommended because the GA `workflow_dispatch` API adds latency and complexity for a synchronous call that must return the issue number in the response.

### B2 — Issue body format

The adapter formats the issue body as:

```markdown
**Form:** {formUID}  
**Submitted:** {_submission_time}  
**Submission UUID:** {_uuid}

| Field | Value |
|---|---|
| question_1 | answer |
| question_2 | answer |
...

<!-- kobo-meta: {"server":"https://kf.kobotoolbox.org","uid":"{formUID}","uuid":"{_uuid}"} -->
```

The HTML comment is on the last line so parsing is unambiguous.

### B3 — GitHub Actions workflow (in the target repo)

File: `.github/workflows/kobo-sync.yml`

```yaml
on:
  issues:
    types: [closed, reopened]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Extract Kobo metadata
        id: meta
        run: |
          BODY='${{ github.event.issue.body }}'
          META=$(echo "$BODY" | grep -oP '(?<=<!-- kobo-meta: ).*(?= -->)')
          echo "server=$(echo "$META" | jq -r .server)"  >> $GITHUB_OUTPUT
          echo "uid=$(echo "$META"    | jq -r .uid)"     >> $GITHUB_OUTPUT
          echo "uuid=$(echo "$META"   | jq -r .uuid)"    >> $GITHUB_OUTPUT

      - name: Skip if no Kobo metadata
        if: steps.meta.outputs.uuid == '' || steps.meta.outputs.uuid == 'null'
        run: echo "No kobo-meta found, skipping." && exit 0

      - name: Resolve submission _id
        id: resolve
        run: |
          QUERY=$(python3 -c "import urllib.parse, json; print(urllib.parse.quote(json.dumps({'_uuid': '${{ steps.meta.outputs.uuid }}'  })))")
          FIELDS=$(python3 -c "import urllib.parse, json; print(urllib.parse.quote(json.dumps(['_id'])))")
          ID=$(curl -sf \
            -H "Authorization: Token ${{ secrets.KOBO_TOKEN }}" \
            "${{ steps.meta.outputs.server }}/api/v2/assets/${{ steps.meta.outputs.uid }}/data.json?query=${QUERY}&fields=${FIELDS}" \
            | jq '.results[0]._id')
          echo "id=$ID" >> $GITHUB_OUTPUT

      - name: Set validation status (closed → approved)
        if: github.event.action == 'closed'
        run: |
          curl -sf -X PATCH \
            -H "Authorization: Token ${{ secrets.KOBO_TOKEN }}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            --data-urlencode "validation_status.uid=validation_status_approved" \
            "${{ steps.meta.outputs.server }}/api/v2/assets/${{ steps.meta.outputs.uid }}/data/${{ steps.resolve.outputs.id }}/validation_status/"

      - name: Set validation status (reopened → on hold)
        if: github.event.action == 'reopened'
        run: |
          curl -sf -X PATCH \
            -H "Authorization: Token ${{ secrets.KOBO_TOKEN }}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            --data-urlencode "validation_status.uid=validation_status_on_hold" \
            "${{ steps.meta.outputs.server }}/api/v2/assets/${{ steps.meta.outputs.uid }}/data/${{ steps.resolve.outputs.id }}/validation_status/"
```

`KOBO_TOKEN` is a repo secret — the same token value already stored in kobo2logie as `KOBO_API_TOKEN_GLOBAL` or `KOBO_API_TOKEN_EU`.

### B4 — GitHub PAT scopes

The GitHub PAT used by the adapter (or stored as a kobo2logie `forwardToken`) needs:
- `repo` scope (for private repos) or `public_repo` (for public)
- Issues: read & write

A fine-grained PAT scoped to a single repo with Issues: read/write is the most secure option.

---

## End-to-end config in kobo2logie UI

For a form with case management enabled, the configure page settings are:

| Setting | Value |
|---|---|
| Forward URL | `https://your-adapter-worker.workers.dev/api/github-issue` |
| Forward token | GitHub PAT |
| Edit original | ✓ |
| Kobo server | `https://kf.kobotoolbox.org` |
| Response field mappings | `number` → `ticket_id`, `html_url` → `ticket_url` |

---

## Implementation order

1. **A1 + A3** — Add `responseFieldMap` to the config schema and injection logic in `hook.ts` (core plumbing, no UI yet)
2. **B1 + B2** — Build the GitHub Issues adapter Worker
3. **A2** — Add UI for response field mappings on the configure page
4. **B3** — Add the GA workflow to the target repo
5. End-to-end test with a real Kobo form → confirm ticket written back → close issue → confirm validation status updated

---

## Files changed (kobo2logie)

| File | Change |
|---|---|
| `src/routes/hook.ts` | Parse `fwdResult.responseBody`, resolve `responsePath` values, merge into `editData` |
| `src/routes/configure.ts` | Accept + store `responseFieldMap` in KV config |
| `src/routes/ui.ts` | Response field mapping UI section on configure page |

No new files, no new bindings, no new secrets required on the kobo2logie side.

---

## Security notes

- The `responsePath` resolver must only do simple property access on the parsed response object — no `eval`, no prototype access. Whitelist to string/number leaf values only.
- The GitHub PAT is stored as a `forwardToken` in KV, which is already treated as an opaque secret (never logged, never sent to the browser).
- The metadata footer in the issue body is parsed server-side in GA, not in a browser — XSS is not a concern, but the curl/jq pipeline should validate that `uuid` is a UUID format before constructing the Kobo URL to prevent header injection.
