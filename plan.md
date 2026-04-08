# kobo2logie — Architecture Plan

## Decisions

| Question | Decision |
|---|---|
| Submission data source | **Live webhook only** — data shown is whatever Kobo POSTs while the tab is open |
| Historical data | **None** — no Kobo API submission fetching; start fresh each session |
| Session state | **In-memory in a Durable Object** — per form UID, cleared on idle |
| Real-time bridge | **Cloudflare Durable Objects** — in-memory relay, no persistence |
| Token | **Entered in the UI** — stored in `localStorage`, used only for media proxy |
| View page auth | **None** — URL is its own access control |
| Kobo server | **Configurable in the UI** — base URL saved to `localStorage` |
| Hosting | **Cloudflare Workers + Durable Objects** |

---

## Overview

kobo2logie is a real-time webhook viewer for KoboToolbox. When a form is submitted in Kobo,
the full JSON payload is POSTed to the Worker, which relays it instantly to any open browser
tab viewing that form's page — no database, no historical fetches, no Kobo API calls for
submission data. The Worker keeps an in-memory ringbuffer of the last 50 submissions per form
UID inside a Durable Object; the DO hibernates and clears state when idle.

The only authenticated Kobo API usage is the **media proxy**: images and files from submissions
are streamed through the Worker using a token the user enters in the UI.

---

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Cloudflare Workers** | Edge, zero cold-starts, free tier, global URL out of the box |
| Real-time relay | **Cloudflare Durable Objects** | Stateful in-memory bridge between POST and browser WebSocket |
| Framework | **Hono** | Tiny (~14 kB) Worker-native router; works inside DOs too |
| Frontend | **Vanilla HTML/JS** served from the Worker | No build step; template literal HTML |
| Storage | **None** (DO memory is ephemeral) | DO state vanishes when all connections close |
| Language | TypeScript | Type safety for Kobo JSON shapes |
| Tooling | **Wrangler** | CF CLI for local dev and deploy |

### Why Durable Objects?

Workers are stateless — each request runs in isolation with no shared memory. Kobo's POST and
the browser's WebSocket connection arrive as two separate Worker requests and cannot communicate
directly. A Durable Object gives each form UID a tiny addressable stateful actor that:
- Receives the submission from the POST handler
- Pushes it over an open WebSocket to all connected browser tabs
- Keeps an in-memory ringbuffer (last 50 submissions) for tabs that connect shortly after a POST
- Drops all state when the last connection closes and an idle alarm fires

DOs are included in the Cloudflare Workers free tier.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  KoboToolbox Project  (form asset UID: aXYZ123)                      │
│  REST Service URL: https://kobo2logie.workers.dev/api/hook/aXYZ123   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ POST  (full submission JSON)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (Hono)                                           │
│                                                                      │
│  GET  /                       → home page HTML                      │
│  GET  /view/:formUID          → viewer page HTML                    │
│  POST /api/hook/:formUID      → forward payload to DO               │
│  GET  /api/stream/:formUID    → WebSocket upgrade via DO            │
│  GET  /api/media              → proxy Kobo media file with token    │
└──────────┬─────────────────────────────────┬─────────────────────────┘
           │ stub.fetch() (internal)         │ GET + Authorization: Token {…}
           ▼                                 ▼
┌──────────────────────┐          ┌──────────────────────┐
│  Durable Object      │          │  Kobo media storage  │
│  FormSession         │          │  (images/files only) │
│  keyed by formUID    │          └──────────────────────┘
│                      │
│  in-memory buffer    │◄── POST payload pushed in
│  (last 50, FIFO)     │
│                      │──► WebSocket broadcast to all open tabs
└──────────────────────┘

Browser tab  (/view/aXYZ123)
 ├─ opens WebSocket to /api/stream/aXYZ123
 ├─ receives buffered submissions on connect, then live ones in real-time
 ├─ accumulates in JS array (in-memory, cleared on tab close)
 ├─ renders each: raw JSON in <pre> + media in 3-col image grid
 └─ token from localStorage added to /api/media?… requests
```

---

## Real-time Flow — Step by Step

1. **User opens `/view/{formUID}`** in a browser tab.
   - JS opens a WebSocket to `/api/stream/{formUID}`.
   - Worker upgrades the request and passes it to the `FormSession` DO for that form UID.
   - DO registers the connection and immediately sends any buffered submissions (up to 50) as
     individual JSON messages.

2. **Kobo submits a form** → REST Service POSTs JSON to `/api/hook/{formUID}`.
   - Worker validates the body (must be JSON, max 1 MB).
   - Worker forwards the payload to the `FormSession` DO via internal stub.
   - DO appends it to the in-memory buffer (auto-drops oldest when > 50) and broadcasts it
     over all open WebSocket connections.
   - Worker returns `200 OK` to Kobo.

3. **Browser receives the WebSocket message** → parses JSON, prepends to submission list,
   renders JSON + attachment grid.

4. **Tab closed** → DO removes that WebSocket. If no connections remain and the idle alarm fires
   (~60 s), the DO hibernates and the buffer is cleared.

5. **New tab opened later** → receives whatever is still in the buffer, picks up from there.

---

## Route Map

| Route | Method | What it does |
|---|---|---|
| `/` | GET | Home: instructions + input to generate hook/view URLs from a form UID |
| `/view/:formUID` | GET | Viewer page (HTML + inline JS) |
| `/api/hook/:formUID` | POST | Webhook receiver: validates JSON, forwards to DO |
| `/api/stream/:formUID` | WS | WebSocket upgrade → DO handles the persistent connection |
| `/api/media` | GET | Authenticated media proxy (token from query param) |

---

## Durable Object — `FormSession`

```typescript
class FormSession {
  connections: Set<WebSocket>        // active browser tabs
  buffer: SubmissionPayload[]        // last 50 submissions, FIFO

  handleWebSocket(ws: WebSocket)     // register + send buffer to new connection
  broadcast(payload: unknown)        // push to all open sockets
  addToBuffer(payload: unknown)      // push + trim to 50
  alarm()                            // clears buffer + hibernates after 60s idle
}
```

No `storage.put()` calls — purely in-memory JavaScript state. When all connections close and
the alarm fires, the instance hibernates and memory is freed automatically.

---

## UI — View Page (`/view/:formUID`)

```
┌───────────────────────────────────────────────────────────────────────┐
│  kobo2logie                               [⚙ Settings]               │
│  Form: aXYZ123                                                        │
│  Webhook URL:  https://kobo2logie.workers.dev/api/hook/aXYZ123  [📋] │
│  ● Live  (WebSocket connected)                                        │
├───────────────────────────────────────────────────────────────────────┤
│  ▸ Settings (collapsible)                                             │
│    Token:    [_________________________________]                       │
│    Base URL: [https://kf.kobotoolbox.org_____]  [Save]               │
├───────────────────────────────┬───────────────────────────────────────┤
│  Submissions (3)              │  Raw JSON                             │
│  ┌─────────────────────────┐  │  ┌─────────────────────────────────┐  │
│  │ #3  14:32  (new) ▶     │  │  │ {                               │  │
│  │ #2  14:28             │  │  │   "_id": 12345,                 │  │
│  │ #1  14:15             │  │  │   "_attachments": […]           │  │
│  └─────────────────────────┘  │  │ }                               │  │
│                               │  └─────────────────────────────────┘  │
│                               │                                        │
│                               │  Attachments                          │
│                               │  ┌───────┐ ┌───────┐ ┌───────┐       │
│                               │  │ img 1 │ │ img 2 │ │ img 3 │       │
│                               │  └───────┘ └───────┘ └───────┘       │
│                               │  ┌───────┐                            │
│                               │  │ img 4 │                            │
│                               │  └───────┘                            │
└───────────────────────────────┴───────────────────────────────────────┘
```

- **Connection indicator**: green "Live" when WS open; yellow "Reconnecting…" on drop
  (auto-retry with exponential backoff).
- **Submission list** (left): prepended on each WS message, newest first.
- **JSON panel** (right, top): pretty-printed `<pre>` with `JSON.stringify(data, null, 2)`
  via `textContent` (no `innerHTML`), plus a copy button.
- **Image grid** (right, bottom): `grid-template-columns: repeat(3, 1fr)`. Each image MIME
  attachment rendered as `<img src="/api/media?url=…&token=…&base=…">`. Non-images are
  download links. Clicking an image opens full-size in a new tab.

---

## Token & Settings

The token is only used for the media proxy. Submission JSON always shows without it.

| Setting | Storage | Purpose |
|---|---|---|
| `kobo_token` | `localStorage` | Appended to `/api/media?token=…` requests |
| `kobo_base_url` | `localStorage` | Used for SSRF hostname validation in the media proxy (default: `https://kf.kobotoolbox.org`) |

If no token is set, image grid cells show a placeholder with a "Set token in Settings" prompt.

---

## KoboToolbox Payload — Real Example

The following is a real submission payload (truncated to relevant fields):

```json
{
  "_id": 719641374,
  "_uuid": "8df26ea5-d523-4819-8ec8-ffbf26cb1f85",
  "_xform_id_string": "a6LDoopohAy6s2Vw9gWo8p",
  "_submission_time": "2026-04-08T19:51:52",
  "_submitted_by": null,
  "name": "Josh",
  "image_of_something": "me-20_51_49.jpg",
  "_attachments": [
    {
      "uid": "attZtrUkV6ywjHCeDy9SjmWZ",
      "mimetype": "image/jpeg",
      "filename": "bob_kobo/attachments/0406d9a7f30f4c1eb5d7bad7e0d1cc02/8df26ea5-.../me-20_51_49.jpg",
      "media_file_basename": "me-20_51_49.jpg",
      "question_xpath": "image_of_something",
      "is_deleted": false,
      "download_url":        "https://kf.kobotoolbox.org/api/v2/assets/a6LDoopohAy6s2Vw9gWo8p/data/719641374/attachments/attZtrUkV6ywjHCeDy9SjmWZ/",
      "download_large_url":  "https://kf.kobotoolbox.org/api/v2/assets/a6LDoopohAy6s2Vw9gWo8p/data/719641374/attachments/attZtrUkV6ywjHCeDy9SjmWZ/large/",
      "download_medium_url": "https://kf.kobotoolbox.org/api/v2/assets/a6LDoopohAy6s2Vw9gWo8p/data/719641374/attachments/attZtrUkV6ywjHCeDy9SjmWZ/medium/",
      "download_small_url":  "https://kf.kobotoolbox.org/api/v2/assets/a6LDoopohAy6s2Vw9gWo8p/data/719641374/attachments/attZtrUkV6ywjHCeDy9SjmWZ/small/"
    }
  ]
}
```

### Notes on the real format

- **Base URL is `kf.kobotoolbox.org`** (KoboToolbox hosted), not `kc.kobotoolbox.org`.
- **Attachment URLs are v2 API paths** — `/api/v2/assets/{formUID}/data/{submissionID}/attachments/{attachmentUID}/{size}/`.
  These require the `Authorization: Token …` header to fetch.
- **Attachment identifier is `uid`** (string), not a numeric `id`.
- **`question_xpath`** links each attachment to the form field that captured it — useful for
  labelling images in the grid.
- **`_xform_id_string`** in the payload is the form UID (same value used as the route param).
- Grid thumbnails use `download_medium_url`; full-size click-through uses `download_large_url`.

---

## File Structure

```
kobo2logie/
├── plan.md
├── package.json
├── tsconfig.json
├── wrangler.toml              # Worker + DO bindings, compatibility date
└── src/
    ├── index.ts               # Hono app entry — mounts all routes, exports DO class
    ├── FormSession.ts         # Durable Object: WebSocket hub + in-memory buffer
    ├── routes/
    │   ├── ui.ts              # GET /  and  GET /view/:formUID
    │   ├── hook.ts            # POST /api/hook/:formUID
    │   ├── stream.ts          # GET /api/stream/:formUID (WebSocket upgrade)
    │   └── media.ts           # GET /api/media
    └── lib/
        └── kobo.ts            # URL builders, host validation, attachment helpers
```

No additional build framework needed. Wrangler bundles TypeScript directly via esbuild.

---

## `wrangler.toml` (outline)

```toml
name = "kobo2logie"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
DEFAULT_KOBO_BASE_URL = "https://kf.kobotoolbox.org"

[[durable_objects.bindings]]
name = "FORM_SESSION"
class_name = "FormSession"

[[migrations]]
tag = "v1"
new_classes = ["FormSession"]
```

---

## Security Considerations

- **Token stays in the browser**: used only as a query param for `/api/media`. Visible in
  browser DevTools — acceptable for a personal/team tool.
- **SSRF protection on media proxy**: Worker validates that the target `url` param's hostname
  exactly matches the `base` param's hostname. Mismatched or arbitrary URLs → `400`.
- **Webhook unauthenticated by design**: Kobo REST Services send plain POSTs. Since the DO
  holds at most 50 submissions in RAM and they're ephemeral, spurious POSTs are low-risk —
  worst case the buffer fills with garbage and legitimate submissions drop off.
- **Payload size limit**: `1 MB` enforced on the webhook route body.
- **No `eval` / dynamic code**: JSON rendered via `textContent` in a `<pre>` — no `innerHTML`.
- **WebSocket origin check**: DO rejects WebSocket upgrades from origins other than the
  Worker's own hostname.
- **CORS**: `/api/*` routes restrict `Access-Control-Allow-Origin` to the Worker's own origin.

---

## Deployment Steps

1. **Install Wrangler and log in**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Scaffold the project**
   ```bash
   npm create cloudflare@latest kobo2logie -- --type=hello-world --ts
   cd kobo2logie
   npm install hono
   ```

3. **Local dev** (Wrangler emulates Durable Objects locally)
   ```bash
   wrangler dev
   # Worker available at http://localhost:8787
   ```

4. **Deploy**
   ```bash
   wrangler deploy
   # Outputs: https://kobo2logie.<your-subdomain>.workers.dev
   ```

5. **Use it**
   - Open `https://kobo2logie.<subdomain>.workers.dev/view/{your-form-uid}`
   - Expand Settings → enter your Kobo token + base URL → Save
   - Copy the webhook URL shown in the page header
   - In KoboToolbox: Project → Settings → REST Services → Add Service → paste URL
   - Submit a form → appears in real-time → JSON + image grid rendered
