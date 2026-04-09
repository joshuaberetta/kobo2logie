# Plan: `/configure` page — Kobo API setup wizard

## Goal

Add a `/configure` page to the app with three inputs (API token, form UID, server) and two action buttons that call the KoboToolbox API **directly from the browser** to:
1. Auto-register this Worker's webhook URL as a REST Service on the Kobo form
2. Share the form with user `wfp_logie` so the app can authenticate requests

---

## Steps

### Phase 1 — Route

Add `ui.get("/configure", ...)` in `src/routes/ui.ts`, returning inline HTML following the same pattern as the existing home page and `/view/:formUID` handlers. `location.origin` is available client-side, so no server-side origin injection is needed.

### Phase 2 — Page layout

Three input fields:
- **API Token** — `<input type="password" autocomplete="off" />`
- **Form UID** — `<input type="text" />`
- **Server** — `<select>` with two options:
  - Global → `https://kf.kobotoolbox.org`
  - EU → `https://eu.kobotoolbox.org`

Two independent action sections (side-by-side on desktop, stacked on mobile), each containing:
- A labelled `<button>`
- A status `<div>` that shows an inline spinner during the request, then a success or error message

### Phase 3 — Client-side JS

**`configureRestService()`**
- Reads token, formUID, serverBase from inputs
- Derives `webhookUrl = location.origin + '/api/hook/' + formUID`
- `POST {server}/api/v2/assets/{uid}/hooks/` with:
  ```json
  {
    "name": "LogIE Integration",
    "endpoint": "<webhookUrl>",
    "active": true,
    "subset_fields": [],
    "email_notification": true,
    "export_type": "json",
    "auth_level": "no_auth",
    "settings": { "custom_headers": {} },
    "payload_template": ""
  }
  ```
  Header: `Authorization: Token <token>`
- On success: display the created endpoint URL in the status area
- On failure: display the HTTP status and error text

**`configurePermissions()`**
- Single `POST` to `{server}/api/v2/assets/{uid}/permission-assignments/bulk/` with:
  ```json
  [
    {
      "user": "{server}/api/v2/users/wfp_logie/",
      "permission": "{server}/api/v2/permissions/view_submissions/"
    }
  ]
  ```
  Header: `Authorization: Token <token>`
- `wfp_logie + view_submissions` — allows the app to authenticate and read submissions
- Reports success on `response.ok`, or the HTTP status + error text on failure

### Phase 4 — Navigation

- Add a small "⚙ Configure" link in the home page card (`/`) pointing to `/configure`
- Add a "← Home" back-link at the top of the configure page

---

## Files modified

| File | Change |
|---|---|
| `src/routes/ui.ts` | Add `GET /configure` handler + nav links to/from home |
| `src/index.ts` | **No change** — existing `app.route("/", ui)` already covers `/configure` |

---

## Decisions

- **Username `wfp_logie` is hardcoded** — fixed per requirement; no input field needed
- **API calls are browser-direct** — no new Worker proxy routes are added
- **Token not persisted to `localStorage`** — avoids token leakage across sessions; user re-enters it each visit on this page (distinct from the viewer page, which does store it)

---

## Verification

1. `npm run dev` → navigate to `http://localhost:8787/configure`, confirm page renders correctly
2. With a real token + form UID, click **Configure REST Services** → verify the new hook appears in KoboToolbox under **Settings → REST Services**
3. Click **Configure User Permissions** → verify `wfp_logie` appears in the form's sharing/permissions settings in KoboToolbox
4. Test with both EU and Global server selections to confirm the correct base URL is used in requests

---

## Open considerations

1. **CORS risk** 