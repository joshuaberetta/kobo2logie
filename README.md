# kobo2logie

A Cloudflare Worker that receives KoboToolbox form submission webhooks and enriches, processes, and forwards them to external services. Provides a browser-based configuration UI to register the KoboToolbox REST Service integration and configure all pipeline options per form, with no server restarts required.

Built with [Hono](https://hono.dev/) on Cloudflare Workers + Durable Objects.

---

## What it does

kobo2logie sits between KoboToolbox and the rest of your data pipeline. When a form is submitted on Kobo, the JSON payload is POSTed to this worker, which then runs any combination of the following steps — all configurable per form through the browser UI:

### Real-time submission viewer
Every incoming submission is instantly pushed over WebSocket to any open browser tabs viewing that form's dashboard. The viewer shows a live submission list, a JSON detail panel, and an image grid for photo attachments. Up to 50 submissions are buffered in memory per form (cleared 60 seconds after the last tab closes).

### Field filtering
Optionally forward only a selected subset of form fields. `_uuid` is always included regardless. If none of the configured fields match, the full payload is forwarded as a fallback.

### Forwarding
POST the submission payload to any HTTPS URL, with an optional `Authorization: Bearer` token. Forwarding can also target LogIE directly using server-side environment variables (no token stored in KV). A **conditional rule engine** (AND/OR groups of field comparisons) can gate forwarding so it only fires when the submission matches specific criteria.

### Static value injection
Append a set of static key-value pairs under a `_metadata` key in every forwarded payload — useful for tagging submissions with a project code, region, or deployment identifier.

### Audio transcription
Fetch audio attachments from Kobo and transcribe them via OpenAI (Whisper). The transcript is injected into the payload as `<question_xpath>_transcript` before forwarding. Optionally translate the transcript into another language in the same step. Files over 25 MB are silently skipped.

### Image field extraction
Send image attachments to OpenAI vision and extract structured fields from them (e.g. read a document, parse a photo of a form). Per-question prompts define exactly which fields to extract. Extracted values are injected into the forwarded payload and can be written back to Kobo.

### Audio analysis
Transcribe audio attachments and then run structured field extraction against the transcript — extract named entities, assessment scores, or any key facts described in the recording. Per-question prompts control what is extracted.

### Text field extraction
Run AI-powered structured extraction on any free-text answer in the form. Useful for mining named entities, locations, organizations, or custom fields from open-ended responses.

### Geocoding
Two geocoding modes are available, both backed by a self-hosted service using HDX/OCHA COD boundary data. Results are injected into the forwarded payload and written back to Kobo via edit-back.

**Reverse geocoding** — convert GPS coordinates from a Kobo geopoint question (or the default `_geolocation` field) to ADM0–ADM4 P-codes and names. Output keys are prefixed with the geopoint question xpath, e.g. `location_adm1_pcode`.

**Address geocoding** — resolve a free-text address answer to coordinates (`_latitude`, `_longitude`) plus ADM0–ADM4 P-codes and names. Any number of text questions can be enabled. Output keys are prefixed with the question xpath, e.g. `address_latitude`, `address_adm1_name`. Conditional logic can gate geocoding independently of forwarding.

### Edit-back to Kobo
Write any enriched values (transcripts, extracted fields, geocoded P-codes, static appended values) back to the original Kobo submission via the Kobo bulk-edit API. This makes enriched data visible inside the Kobo data table without any separate sync step.

### AI-powered validation
Use OpenAI to automatically set a Kobo submission's validation status (`approved`, `not_approved`, or `on_hold`). You provide plain-English criteria for each status and the AI reviews the submission payload and decides. The reasoning can optionally be written back to the submission as a field. Conditional logic can restrict which submissions are validated automatically.

### Email notifications
Send HTML email notifications via [Resend](https://resend.com) on each submission. Options include:

- **Template body** — write a static body with `{{field_xpath}}` placeholders that are filled from the submission.
- **AI-generated body** — provide instructions and let GPT-4o-mini compose a professional HTML email from the submission data.
- **File attachments** — attach any Kobo media file (photo, document) directly to the email.
- **PDF report attachment** — generate a formatted PDF report of the submission (via the kobo2pdf service) and attach it to the email.
- **Conditional sending** — only send the email when the submission matches a configured rule condition.
- **Dynamic recipients** — specify `to`, `cc`, and `bcc` as static email lists and/or field xpaths that contain email addresses extracted from the submission.

### PDF reports
Generate a formatted PDF from a submission using the [kobo2pdf](https://kobo2pdf.imtools.info) rendering service. Image attachments are fetched from Kobo and embedded in the PDF. The PDF can be attached to email notifications.

---

## Pipeline execution order

For each incoming submission, the following steps run in order (all fire-and-forget, non-blocking to the webhook response):

```
1. Geocode coordinates → P-codes
2. Forward payload (with transcription / extraction / analysis / media)
3. Edit-back enriched values to Kobo
4. AI validation → set Kobo validation status
5. Log result to Durable Object (visible in the browser viewer)
6. Send email notification (with optional PDF attachment)
```

All enrichment results from step 2 (transcripts, extracted fields) are available to steps 3, 4, and 6.

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
OPENAI_API_KEY=sk-...          # required for transcription, extraction, analysis, and AI validation
RESEND_API_KEY=re_...          # required for email notifications
RESEND_FROM_EMAIL=you@domain.com  # verified Resend sender address
LOGIE_API_URL=https://...      # optional: LogIE API endpoint
LOGIE_API_KEY=...              # optional: LogIE API key
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
wrangler secret put OPENAI_API_KEY       # required for AI features
wrangler secret put RESEND_API_KEY       # required for email notifications
wrangler secret put RESEND_FROM_EMAIL    # required for email notifications
wrangler secret put LOGIE_API_URL        # optional: LogIE endpoint
wrangler secret put LOGIE_API_KEY        # optional: LogIE API key
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
| **Prompt** | Optional context hint passed to the transcription model. |
| **Translate to** | Optional language — the transcript is translated after transcription. |

> Files larger than 25 MB are silently skipped (OpenAI hard limit). Transcription errors never block submission forwarding.

#### Additional enrichment options

The configuration page also exposes:

- **Image extraction** — run OpenAI vision on image attachments to extract structured fields per question.
- **Audio analysis** — transcribe audio and run structured field extraction on the resulting transcript.
- **Text extraction** — run AI extraction on free-text answers to surface named entities and key facts.
- **Geocoding** — reverse-geocode a geopoint question's coordinates to ADM0–ADM4 P-codes.
- **Edit-back** — write all enriched values back to the original Kobo submission.
- **AI validation** — automatically set the Kobo validation status based on configurable AI criteria.
- **Email notifications** — send email on each submission with optional AI-generated body and PDF attachment.
- **Conditional logic** — AND/OR rule groups that gate forwarding, geocoding, validation, or email independently.

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
    ├── FormSession.ts         # Durable Object — WebSocket hub + submission buffer + log
    ├── types.ts               # Shared Env interface + Condition/LogEntry types
    ├── routes/
    │   ├── ui.ts              # GET / (setup) and GET /:uid (project settings UI)
    │   ├── configure.ts       # /api/configure/* — Kobo API proxy + KV config read/write
    │   ├── hook.ts            # POST /api/hook/:formUID — webhook receiver + enrichment pipeline
    │   ├── stream.ts          # WebSocket /api/stream/:formUID — live viewer connection
    │   └── media.ts           # GET /api/media — authenticated Kobo media proxy
    └── lib/
        ├── kobo.ts            # Types, SSRF allowlist, attachment helpers
        ├── forward.ts         # Multipart forwarding + enrichment orchestration
        ├── transcribe.ts      # OpenAI Whisper audio transcription + optional translation
        ├── extract.ts         # OpenAI vision image → structured field extraction
        ├── analyzeAudio.ts    # Audio transcription → structured field analysis
        ├── extractText.ts     # Free-text answer → structured field extraction
        ├── geocode.ts         # Reverse geocoding → ADM0–ADM4 P-codes (imtools geocoder)
        ├── koboEdit.ts        # Kobo bulk-edit API + validation status update
        ├── validateSubmission.ts  # AI submission validation (OpenAI)
        ├── pdfReport.ts       # PDF report generation via kobo2pdf service
        ├── evaluateCondition.ts   # Rule-based condition evaluator (AND/OR groups)
        ├── submissionValue.ts # Nested xpath value resolver for submission payloads
        └── describe.ts        # (unused placeholder)
```

---

## KV config shape

Per-project settings are stored in the `FORWARD_CONFIG` KV namespace under the form UID key:

```json
{
  "server": "https://kf.kobotoolbox.org",
  "forwardUrl": "https://your-service.example.com/webhook",
  "forwardToken": "optional-bearer-token",
  "forwardToLogie": false,
  "fields": ["xpath1", "xpath2"],
  "forwardCondition": { "type": "group", "combinator": "and", "rules": [] },
  "appendValues": [{ "key": "project_code", "value": "SYR-2025" }],
  "forwardMedia": ["photo_question_xpath"],
  "transcribe": {
    "questions": ["audio_question_xpath"],
    "model": "gpt-4o-mini-transcribe",
    "prompt": "optional context for the transcription model",
    "translateTo": "English"
  },
  "extract": {
    "questions": ["photo_question_xpath"],
    "model": "gpt-4o-mini",
    "prompts": {
      "photo_question_xpath": {
        "description": "Optional context",
        "fields": [{ "key": "extracted_field", "instruction": "What to extract" }]
      }
    }
  },
  "analyzeAudio": {
    "questions": ["audio_question_xpath"],
    "model": "gpt-4o-mini",
    "prompts": {}
  },
  "extractText": {
    "questions": ["text_question_xpath"],
    "model": "gpt-4o-mini",
    "prompts": {}
  },
  "geocode": true,
  "geocodeField": "geopoint_question_xpath",
  "geocodeCondition": { "type": "group", "combinator": "and", "rules": [] },
  "editOriginal": true,
  "validateSubmission": {
    "instructions": "Approve if all required fields are filled.",
    "includeReasoning": true,
    "options": {
      "approved": "All required fields present and valid.",
      "notApproved": "Missing required data.",
      "onHold": "Needs manual review."
    },
    "condition": { "type": "group", "combinator": "and", "rules": [] }
  },
  "emailNotification": {
    "to": ["recipient@example.com"],
    "toXPaths": ["email_question_xpath"],
    "cc": [],
    "bcc": [],
    "subject": "New submission: {{title_field}}",
    "body": "A submission was received.\n\nName: {{name_field}}",
    "aiBody": { "instructions": "Write a concise notification for field officers." },
    "attachments": ["photo_question_xpath"],
    "pdfReport": { "template": "submission", "formTitle": "Assessment Form" },
    "condition": { "type": "group", "combinator": "and", "rules": [] }
  }
}
```

Key notes:
- `fields` — empty array means forward all fields; `_uuid` is always included.
- `forwardToLogie` — when `true`, uses `LOGIE_API_URL` / `LOGIE_API_KEY` env vars instead of `forwardUrl` / `forwardToken`.
- `transcribe` / `extract` / `analyzeAudio` / `extractText` — `null` or absent means that enrichment step is disabled.
- `geocode` — requires `geocodeField` (a geopoint xpath) or falls back to `_geolocation`.
- `editOriginal` — writes all enrichment results back to the Kobo submission via bulk-edit.
- `validateSubmission` — `null` or absent means AI validation is disabled.
- `emailNotification` — `null` or absent means no email is sent. `aiBody` takes priority over `body` when present.
- All `condition` fields use the same rule-group schema and are optional; absent means the step always runs.

---

## Security notes

- **Your API token is never stored server-side.** It is used directly from the input field during configuration calls and is never persisted. Tokens will be visible in browser DevTools network requests during setup.
- **Only allowed Kobo servers are contacted.** The configure endpoints enforce an allowlist (`kf.kobotoolbox.org`, `eu.kobotoolbox.org`) to prevent SSRF.
- **The media proxy blocks SSRF.** Only URLs from the configured Kobo base URL hostname can be proxied.
- **The webhook endpoint is unauthenticated.** The form UID in the URL is the only access discriminator.
- **Audio files are streamed directly to OpenAI** and are not stored by the Worker.
