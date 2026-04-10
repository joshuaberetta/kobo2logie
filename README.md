# kobo2logie

A Cloudflare Worker that receives KoboToolbox form submission webhooks and forwards them to LogIE. Provides a simple configuration UI to set up the KoboToolbox REST Service integration and permissions in one click.

Built with [Hono](https://hono.dev/) on Cloudflare Workers + Durable Objects.

---

## How it works

```
Kobo form submitted
  → POSTs JSON to /api/hook/{formUID}
    → Cloudflare Worker
        → optionally filters fields
        → optionally transcribes audio attachments via OpenAI
        → forwards enriched payload to an external service
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

Create a `.dev.vars` file in the project root with your secrets (this file is gitignored):

```ini
KOBO_API_TOKEN_GLOBAL=your-global-kobo-token
KOBO_API_TOKEN_EU=your-eu-kobo-token
OPENAI_API_KEY=sk-...        # only needed if using audio transcription
```

---

## Deployment

```bash
wrangler deploy
```

On first deploy, Wrangler will print your Worker URL:

```
https://kobo2logie.<your-subdomain>.workers.dev
```

Set production secrets:

```bash
wrangler secret put KOBO_API_TOKEN_GLOBAL
wrangler secret put KOBO_API_TOKEN_EU
wrangler secret put OPENAI_API_KEY   # only needed if using audio transcription
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

The project settings page loads all survey questions directly from the Kobo API on page open. No extra input is needed — the server and credentials are already known from Step 1.

#### Advanced settings

| Setting | Description |
|---|---|
| **Forwarding URL** | Optional HTTPS URL to relay every received submission to an external service. |
| **Bearer token** | Optional token sent as `Authorization: Bearer <token>` on each forwarded request. |

#### Fields subset

A scrollable checkbox list of every question in the form. All fields are checked by default (forward everything). Uncheck individual fields to exclude them from the forwarded payload.

- The header shows a **selected / total** count badge.
- Use **Select all** / **Deselect all** for bulk actions.
- Use the **▼ / ▶** toggle button to collapse or expand the list.

#### Transcribe audio

Enable the **Transcribe audio** toggle to have audio attachment questions transcribed via the OpenAI API before forwarding. When enabled, a checkbox list of all audio-type questions in the form is shown — all are pre-selected; deselect any you don't want transcribed.

For each transcribed question, the worker fetches the audio attachment from Kobo, sends it to OpenAI, and injects a `<question_xpath>_transcript` key into the submission payload before forwarding.

| Setting | Description |
|---|---|
| **Audio questions** | Checkbox list of audio questions. All selected by default. |
| **Model** | OpenAI model to use — `gpt-4o-mini-transcribe` (default) or `gpt-4o-transcribe`. |

> Files larger than 25 MB are silently skipped (OpenAI hard limit). Transcription errors never block submission forwarding.

Click **Save** to persist all settings. You can return to this page at any time.

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
        ├── forward.ts         # Multipart forwarding to external services
        └── transcribe.ts      # OpenAI audio transcription helper
```

---

## KV config shape

Per-project settings are stored in the `FORWARD_CONFIG` KV namespace under the form UID key:

```json
{
  "server": "https://kf.kobotoolbox.org",
  "forwardUrl": "https://your-service.example.com/webhook",
  "forwardToken": "optional-bearer-token",
  "fields": ["xpath1", "xpath2"],
  "transcribe": {
    "questions": ["audio_question_xpath"],
    "model": "gpt-4o-mini-transcribe"
  }
}
```

- `fields` — empty array means forward all fields.
- `transcribe` — `null` or absent means transcription is disabled.

---

## Security notes

- **Your API token is never stored server-side.** It is used directly from the input field during configuration calls and is never persisted. Tokens will be visible in browser DevTools network requests during setup.
- **Only allowed Kobo servers are contacted.** The configure endpoints enforce an allowlist (`kf.kobotoolbox.org`, `eu.kobotoolbox.org`) to prevent SSRF.
- **The media proxy blocks SSRF.** Only URLs from the configured Kobo base URL hostname can be proxied.
- **The webhook endpoint is unauthenticated.** The form UID in the URL is the only access discriminator.
- **Audio files are streamed directly to OpenAI** and are not stored by the Worker.
