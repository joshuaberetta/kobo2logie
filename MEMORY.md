# kobo2logie — project memory

## What it does
Real-time KoboToolbox webhook receiver + browser viewer. When a Kobo form is submitted, the JSON payload is POSTed to the Worker, relayed instantly over WebSocket to any open browser tabs, and rendered with a JSON panel + image grid.

## Architecture
```
Kobo → POST /api/hook/:formUID → Worker (hook.ts)
                                    → Durable Object (FormSession)
                                        → broadcast via WebSocket
                                            → browser viewer (/view/:formUID)
```
- **Cloudflare Workers** — HTTP routing via Hono v4.7.6
- **Durable Objects** — one `FormSession` instance per `formUID` (keyed by `idFromName(formUID)`)
- **WebSocket Hibernation API** — sockets survive DO hibernation; never use `this.connections = new Set<WebSocket>()`, always use `this.state.getWebSockets()`
- **No database** — buffer is in-memory, max 50 submissions, cleared 60s after last tab closes

## Key files
| File | Purpose |
|---|---|
| `src/index.ts` | Hono app, mounts routes, exports `FormSession` |
| `src/FormSession.ts` | Durable Object — WS hub + buffer |
| `src/types.ts` | Shared `Env` interface (extracted to avoid circular imports) |
| `src/routes/hook.ts` | `POST /api/hook/:formUID` — validates, forwards to DO |
| `src/routes/stream.ts` | `GET /api/stream/:formUID` — WS upgrade, forwarded to DO |
| `src/routes/ui.ts` | Home page + `/view/:formUID` viewer (inline HTML/CSS/JS) |
| `src/routes/media.ts` | `GET /api/media?url=&token=&base=` — authenticated Kobo image proxy |
| `src/lib/kobo.ts` | Types, `isAllowedMediaHost()`, attachment helpers |
| `wrangler.toml` | Worker config, DO binding, vars |

## Durable Object internals
- `fetch("/ws")` → WebSocket upgrade via `state.acceptWebSocket(server)`; sends buffered submissions on connect
- `fetch("/push")` → parses JSON, pushes to `this.buffer`, broadcasts to `state.getWebSockets()`
- `webSocketClose` / `webSocketError` → call `ws.close()`, set idle alarm if no sockets left
- `alarm()` → clears buffer if still no open sockets
- Alarm API: `state.storage.setAlarm()` / `state.storage.deleteAlarm()` (NOT `state.setAlarm`)

## Browser UI patterns
- `WS_PROTO` derived from request URL (`https://` → `wss`, else `ws`) — critical for local dev
- Constants injected into `<script>` via `raw(JSON.stringify(value))` from `hono/html` — plain `${JSON.stringify(...)}` gets HTML-entity-escaped by Hono's `html` tag and breaks JS
- `detail.innerHTML` used to build the detail panel; JSON `<pre>` populated via `textContent` only
- Image click uses `data-full-url` attribute + event delegation (NOT inline `onclick` with `window.open(...)` — that breaks inside `innerHTML` strings due to quote escaping)
- `renderList()` rebuilds the empty-msg div inline via `list.innerHTML` — do NOT try to reference `document.getElementById('empty-msg')` after first render, it gets detached
- Token + base URL stored in `localStorage`, never sent to server except as query params to `/api/media`
- WebSocket reconnects with exponential backoff (1s → 30s max)

## Kobo API facts
- Base URL: `https://kf.kobotoolbox.org`
- Auth: `Authorization: Token <value>`
- Attachment fields: `uid`, `mimetype`, `question_xpath`, `media_file_basename`, `download_url`, `download_medium_url`, `download_large_url`, `is_deleted`
- Submission fields: `_id`, `_uuid`, `_submission_time`, `_attachments`

## Common bugs fixed in this project
1. **Circular import** — routes imported `Env` from `index.ts` which imported routes → extracted `Env` to `types.ts`
2. **Alarm API** — `state.setAlarm()` doesn't exist; correct is `state.storage.setAlarm()`
3. **DO hibernation** — `this.connections = new Set()` wiped on hibernation; replaced with `this.state.getWebSockets()` throughout
4. **`wss://` hardcoded** — local dev uses plain WS; derive from request URL
5. **Hono html tag escapes interpolations** — `JSON.stringify()` output gets `"` → `&quot;`; use `raw()` from `hono/html`
6. **Inline onclick with quotes** — `'window.open(' + JSON.stringify(url) + ', \'_blank\')'` breaks inside `innerHTML` strings; use `data-*` + event delegation
7. **Detached DOM node** — `empty-msg` element gets removed by `list.innerHTML = '...'`, subsequent `getElementById` returns null, silent throw in `try/catch` stops list render; fix by always writing empty state as a fresh HTML string

## Dev commands
```bash
npm run dev       # wrangler dev — runs at localhost:8787
wrangler deploy   # deploy to Cloudflare
```
