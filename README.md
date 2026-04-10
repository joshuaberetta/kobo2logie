# kobo2logie

A Cloudflare Worker that receives KoboToolbox form submission webhooks and forwards them to LogIE. Provides a simple configuration UI to set up the KoboToolbox REST Service integration and permissions in one click.

Built with [Hono](https://hono.dev/) on Cloudflare Workers + Durable Objects.

---

## How it works

```
Kobo form submitted
  → POSTs JSON to /api/hook/{formUID}
    → Cloudflare Worker validates and forwards to LogIE (and optionally to a forwarding URL)
```

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

The Worker runs at `http://localhost:8787`.

---

## Deployment

```bash
wrangler deploy
```

On first deploy, Wrangler will print your Worker URL:

```
https://kobo2logie.<your-subdomain>.workers.dev
```

---

## Setting up an integration

### Step 1 — Register the REST service and permissions

Open the Worker root URL in your browser:

```
https://kobo2logie.<your-subdomain>.workers.dev
```

Fill in:

| Field | Value |
|---|---|
| **Server** | Global (`kf.kobotoolbox.org`) or EU (`eu.kobotoolbox.org`) |
| **Form UID** | Found in the KoboToolbox form URL, e.g. `a6LDoopohAy6s2Vw9gWo8p` |
| **API Token** | From KoboToolbox → Account Settings → API Token |

Click **Set up integration**. The page will:

1. Check if a *LogIE Integration* REST Service already exists on the form — if not, register one pointing at `/api/hook/{formUID}`
2. Check if `wfp_logie` already has `view_submissions` permission — if not, add it while preserving all existing permissions

Each step reports its result inline. Both steps are idempotent — safe to run again if something changes.

Once both succeed, click **Configure project →** to continue.

### Step 2 — Configure project settings

The project settings page (`/{formUID}`) lets you configure per-form options:

| Setting | Description |
|---|---|
| **Fields subset** | Optional list of field names to include in the forwarded payload. Type a name and press **Enter** or **,** to add it as a tag; press **Backspace** to remove the last one. Leave empty to forward all fields. |

Expand **Advanced settings** to configure:

| Setting | Description |
|---|---|
| **Forwarding URL** | Optional HTTPS URL to relay every received submission to another service. Leave empty to disable. |

Click **Save** to persist the settings. You can return to this page at any time at `/{formUID}`.

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
    │   ├── ui.ts              # UI pages: GET / (setup) and GET /:uid (project settings)
    │   ├── configure.ts       # /api/configure/* — Kobo API proxy + project KV config
    │   ├── hook.ts            # POST /api/hook/:formUID — webhook receiver
    │   ├── stream.ts          # WebSocket /api/stream/:formUID
    │   └── media.ts           # Authenticated media proxy /api/media
    └── lib/
        ├── kobo.ts            # Types, SSRF helper, attachment utilities
        └── forward.ts         # Multipart forwarding to external services
```

---

## Security notes

- **Your API token is never stored server-side.** It is used directly from the input field during configuration calls and is never persisted. Tokens will be visible in browser DevTools network requests during setup.
- **Only allowed Kobo servers are contacted.** The configure endpoints enforce an allowlist (`kf.kobotoolbox.org`, `eu.kobotoolbox.org`) to prevent SSRF.
- **The media proxy blocks SSRF.** Only URLs from the configured Kobo base URL hostname can be proxied.
- **The webhook endpoint is unauthenticated.** The form UID in the URL is the only access discriminator.
