# kobo2logie

Real-time webhook viewer for KoboToolbox. When a form is submitted, the full JSON payload appears instantly in the browser — including image previews in a 3-column grid — with no database and no historical data fetching.

Built with [Hono](https://hono.dev/) on Cloudflare Workers + Durable Objects.

---

## How it works

```
Kobo form submitted
  → POSTs JSON to /api/hook/{formUID}
    → Cloudflare Worker forwards to a Durable Object
      → DO broadcasts over WebSocket to all open browser tabs
        → UI renders JSON + attachment images in real-time
```

Submissions are held in memory (last 50 per form) and cleared when the Worker idles. There is no database — closing the browser tab loses the session data, which is intentional.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)
- Wrangler CLI:
  ```bash
  npm install -g wrangler
  wrangler login
  ```

---

## Local development

```bash
git clone <repo-url>
cd kobo2logie
npm install
npm run dev
```

The Worker runs at `http://localhost:8787`. Wrangler emulates Durable Objects locally.

To simulate a Kobo webhook POST during development:

```bash
curl -X POST http://localhost:8787/api/hook/YOUR_FORM_UID \
  -H "Content-Type: application/json" \
  -d @sample-payload.json
```

---

## Deployment

### 1. Deploy to Cloudflare

```bash
wrangler deploy
```

On first deploy, Wrangler will print your Worker URL:

```
https://kobo2logie.<your-subdomain>.workers.dev
```

### 2. (Optional) Custom domain

Add a custom domain in the Cloudflare dashboard under **Workers & Pages → your Worker → Settings → Domains & Routes**.

---

## Setup in KoboToolbox

### Find your form UID

Open your form in KoboToolbox. The UID is in the URL:

```
https://kf.kobotoolbox.org/forms/a6LDoopohAy6s2Vw9gWo8p/...
                                   ^^^^^^^^^^^^^^^^^^^^^^
                                   this is your form UID
```

### Generate your URLs

Open the home page of the deployed Worker and enter the form UID:

```
https://kobo2logie.<your-subdomain>.workers.dev
```

This gives you:

| URL | Purpose |
|---|---|
| `.../api/hook/{formUID}` | Paste into KoboToolbox REST Service |
| `.../view/{formUID}` | Open in your browser to see submissions |

### Configure the integration

Open the configure page and enter your form UID, API token, and server (Global or EU):

```
https://kobo2logie.<your-subdomain>.workers.dev/configure
```

Click **Set up integration**. The page will register the REST Service and apply user permissions simultaneously, showing the result of each inline.

Alternatively, you can register the REST Service manually in KoboToolbox under **Settings → REST Services → Add Service**, pointing the endpoint at `.../api/hook/{formUID}` with method `POST` and content type `application/json`.

---

## Using the viewer

Open the viewer URL in your browser:

```
https://kobo2logie.<subdomain>.workers.dev/view/{formUID}
```

### First-time settings

Click **⚙ Settings** in the top-right corner and enter:

| Field | Value |
|---|---|
| **Kobo API Token** | Your token from KoboToolbox → Account Settings → API Token |
| **Kobo Base URL** | `https://kf.kobotoolbox.org` (or your self-hosted instance URL) |

Click **Save**. These are stored in your browser's `localStorage` and only used for loading media attachments — they are never stored server-side.

### Viewing submissions

- The **left panel** lists received submissions, newest first
- Click any row to load it in the right panel
- The **right panel** shows the raw JSON above a 3-column image grid
- Clicking an image opens the full-size version in a new tab
- Non-image attachments (audio, video, documents) appear as download links
- The **●  Live** indicator in the header shows the WebSocket is connected; it reconnects automatically if dropped

> **Note:** Submissions only appear while the browser tab is open. Refreshing or closing the tab clears the in-memory list. The Worker retains up to 50 submissions for ~60 seconds after all tabs close, so a quick reconnect will recover recent data.

---

## Configuration

All configuration is in `wrangler.toml` under `[vars]`:

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_KOBO_BASE_URL` | `https://kf.kobotoolbox.org` | Kobo server used for SSRF validation |
| `MAX_BUFFER_SIZE` | `50` | Max submissions held in the Durable Object buffer |
| `MAX_BODY_BYTES` | `1048576` | Max webhook payload size (1 MB) |

---

## Project structure

```
kobo2logie/
├── wrangler.toml              # Cloudflare Worker + Durable Object config
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts               # Hono app entry point, route registration
    ├── FormSession.ts         # Durable Object — WebSocket hub + submission buffer
    ├── types.ts               # Shared Env interface
    ├── routes/
    │   ├── ui.ts              # Home page + /view/:formUID viewer + /configure page
    │   ├── configure.ts       # POST /api/configure/* — Kobo API proxy (REST service + permissions)
    │   ├── hook.ts            # POST /api/hook/:formUID
    │   ├── stream.ts          # WebSocket /api/stream/:formUID
    │   └── media.ts           # Authenticated media proxy /api/media
    └── lib/
        └── kobo.ts            # Types, SSRF helper, attachment utilities
```

---

## Security notes

- **Your API token is never stored server-side.** On the viewer page it lives in `localStorage` and is sent as a query parameter to the media proxy only. On the configure page it is used directly from the input field and never persisted. Tokens will be visible in browser DevTools network requests.
- **The media proxy blocks SSRF.** Only URLs from the configured Kobo base URL hostname can be proxied.
- **The webhook endpoint is unauthenticated.** The form UID in the URL is the only access discriminator. Since nothing is persisted, a spurious POST has no lasting effect beyond briefly occupying the buffer.
- **Submission JSON is rendered safely.** The raw JSON `<pre>` block is populated via `textContent`. Dynamic HTML in the detail panel is built from server-controlled field names and URLs, not from submission field values.
