# Plan: PDF Report Generation via Typst (Separate Service)

## Overview

Add the ability to generate a lightweight PDF report for each submission and send it as an email
attachment. The PDF renderer runs in a separate Dockerized service on the same server as the
geocoder. kobo2logie POSTs the enriched submission JSON to that service, receives a PDF in
response, and delivers it via Resend.

A second planned endpoint on the same service will generate summary reports across the full
dataset — this is **not part of the initial build** but the service architecture is designed to
accommodate it from the start.

---

## New Service: `typst-doc-service`

A small, stateless Node/TypeScript HTTP app that:
1. Accepts a JSON body describing what to render
2. Writes the data to a temp directory alongside the appropriate Typst template
3. Shells out to the Typst CLI to compile the `.typ` → PDF
4. Streams the PDF bytes back in the response
5. Cleans up temp files

### Why Typst

- Single self-contained binary — easy to add to a Docker image with no LaTeX infrastructure
- First-class JSON data ingestion via `json()` built-in
- Expressive layout with a modern syntax; tables, images, boxed sections all supported
- Fast compile times (sub-second for a single submission report)

---

## Service API

### `POST /render`

Renders a single-submission PDF report.

**Request**

```
POST /render
Content-Type: application/json

{
  "template": "submission",
  "data": { ...enrichedSubmissionObject },
  "meta": {
    "formTitle": "Household Assessment",
    "logoUrl": "https://...",     // optional — fetched and embedded at render time
    "reportDate": "2026-04-13"   // optional — defaults to now
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `template` | yes | Name of a `.typ` file in the templates directory, without extension |
| `data` | yes | Full enriched submission payload (see below for shape) |
| `meta` | no | Display metadata not present in the raw submission |

**Response**

```
200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="submission-{_uuid}.pdf"

<binary PDF bytes>
```

Non-200 responses are plain-text error messages.

---

### `POST /render/summary` *(future — not in initial build)*

Renders an aggregate summary report over a dataset.

```
POST /render/summary
Content-Type: application/json

{
  "template": "summary",
  "submissions": [ ...array of enriched submission objects ],
  "meta": {
    "formTitle": "...",
    "dateRange": { "from": "2026-01-01", "to": "2026-04-13" },
    "generatedAt": "2026-04-13T12:00:00Z"
  }
}
```

Same response format; filename would be `summary-{formTitle}-{date}.pdf`.

---

## Enriched Submission Shape (for reference)

The JSON object that kobo2logie sends to `/render` is the submission after all pipeline steps
have run. It may contain:

| Field group | Example keys | Source |
|---|---|---|
| Core Kobo fields | `_id`, `_uuid`, `_submission_time`, `_geolocation` | Kobo webhook |
| Form question fields | `name`, `age`, `household_size`, `image_of_site` | Kobo webhook |
| Attachments metadata | `_attachments[].download_url`, `mimetype`, `question_xpath` | Kobo webhook |
| Geocoded P-codes | `_geo_adm0_pcode`, `_geo_adm1_name`, `_geo_adm2_pcode`, ... | geocoder service |
| AI extracted fields | arbitrary keys written back by `extractFields()` | OpenAI vision |
| AI transcription | arbitrary keys written back by `transcribeAudio()` | OpenAI Whisper |
| AI analysis | arbitrary keys written back by `analyzeAudio()` | OpenAI |
| Appended metadata | `_metadata.{key}` | `appendValues` config |
| Validation decision | `_ai_validation_decision`, `_ai_validation_reasoning` | OpenAI |

The Typst template should iterate over all keys → values and render them in a clean table layout
regardless of the exact field set (dynamic rendering), with special handling for known prefixes
(`_geo_`, `_attachments`, `_metadata`, etc.).

---

## Service Implementation

### Repository structure

```
typst-doc-service/
  Dockerfile
  package.json
  tsconfig.json
  src/
    index.ts          # Express/Hono HTTP server
    render.ts         # core render logic: temp dir, run typst, return bytes
    types.ts          # RenderRequest, RenderMeta, etc.
  templates/
    submission.typ    # single-submission template
    summary.typ       # aggregate summary template (stub for now, enabled later)
  .dockerignore
  docker-compose.yml  # optional compose for local dev
```

### Node HTTP server (`src/index.ts`)

Use **Hono** (consistent with kobo2logie) with the Node.js adapter (`@hono/node-server`). One
route: `POST /render`. A second `POST /render/summary` route can be added later without any
structural changes.

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { handleRender } from "./render.js";

const app = new Hono();
app.post("/render", handleRender);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
```

Keep the server minimal — no auth middleware in initial build (rely on network-level isolation;
the service is not exposed publicly). Add a simple bearer-token check via an `API_SECRET` env
var if the server requires a public port.

### Render logic (`src/render.ts`)

```ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMPLATES_DIR = new URL("../templates", import.meta.url).pathname;
const TYPST_BIN = process.env.TYPST_BIN ?? "typst";

export async function renderSubmission(
  templateName: string,
  data: Record<string, unknown>,
  meta: Record<string, unknown>
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "typst-"));
  try {
    // Write the JSON payload that the .typ template will read
    await writeFile(join(dir, "data.json"), JSON.stringify({ data, meta }));
    // Copy/symlink the template into the temp dir so relative imports work
    const inputPath = join(TEMPLATES_DIR, `${templateName}.typ`);
    const outputPath = join(dir, "output.pdf");
    await execFileAsync(TYPST_BIN, ["compile", inputPath, outputPath, "--root", dir], {
      timeout: 30_000,
    });
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

**Security note**: `templateName` must be validated against an allowlist of known template names
before constructing the file path — never pass it raw to avoid path traversal:

```ts
const ALLOWED_TEMPLATES = new Set(["submission", "summary"]);
if (!ALLOWED_TEMPLATES.has(templateName)) {
  throw new Error("Unknown template");
}
```

### Typst template (`templates/submission.typ`)

The template reads the JSON file written by the Node process:

```typst
#let payload = json("/data.json")
#let data    = payload.data
#let meta    = payload.meta

#set document(title: meta.at("formTitle", default: "Submission Report"))
#set page(margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 10pt)

// ── Header ──────────────────────────────────────────────────────────
#grid(columns: (1fr, auto),
  [
    #text(size: 14pt, weight: "bold")[#meta.at("formTitle", default: "Submission Report")]
    #linebreak()
    #text(size: 8pt, fill: gray)[
      Submitted: #data.at("_submission_time", default: "") |
      UUID: #data.at("_uuid", default: "")
    ]
  ],
  // logo placeholder — replace with image() once logo support is wired up
  []
)

#line(length: 100%)

// ── Response fields ──────────────────────────────────────────────────
// Group fields by prefix, skip internal Kobo metadata except key identifiers
#let skip_keys = ("_attachments", "_validation_status", "_submitted_by",
                  "_tags", "_notes", "_status", "_bamboo_dataset_id",
                  "_xform_id_string", "_version_", "formhub")

#let display_fields = data.pairs().filter(pair =>
  not skip_keys.any(sk => pair.first().starts-with(sk))
)

#table(
  columns: (auto, 1fr),
  stroke: 0.5pt + luma(200),
  inset: 6pt,
  fill: (_, row) => if calc.odd(row) { luma(245) } else { white },
  ..display_fields.map(pair => (
    text(weight: "bold", pair.first()),
    str(pair.last()),
  )).flatten()
)

// ── Geo fields (if present) ──────────────────────────────────────────
#let geo_fields = data.pairs().filter(pair => pair.first().starts-with("_geo_"))

#if geo_fields.len() > 0 [
  #v(8pt)
  #text(weight: "bold", size: 11pt)[Administrative Location]
  #table(
    columns: (auto, 1fr),
    stroke: 0.5pt + luma(200),
    inset: 6pt,
    ..geo_fields.map(pair => (pair.first(), str(pair.last()))).flatten()
  )
]
```

This gives a clean two-column key/value layout with alternating row shading, a header band, and
a separate geo section. The template is intentionally generic — form-specific templates (e.g.
with field labels instead of xpath names, or multiple sections) can be added later as additional
`.typ` files.

---

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Install Typst CLI from the official musl binary release
RUN apk add --no-cache wget xz \
  && wget -qO- https://github.com/typst/typst/releases/download/v0.11.1/typst-x86_64-unknown-linux-musl.tar.xz \
     | tar -xJ --strip-components=1 -C /usr/local/bin typst-x86_64-unknown-linux-musl/typst \
  && typst --version

COPY --from=builder /app/dist ./dist
COPY templates/ templates/
COPY package.json ./
RUN npm ci --omit=dev

ENV PORT=3000
ENV TYPST_BIN=typst
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Pin the Typst version explicitly (shown as `v0.11.1` above) and update it deliberately —
template syntax can change between Typst releases.

---

## Integration in kobo2logie

### Config shape addition

Add one new optional key to the per-form `FORWARD_CONFIG` KV record:

```ts
pdfReport?: {
  serviceUrl: string;   // e.g. "http://192.168.1.10:3000"
  template?: string;    // defaults to "submission"
  formTitle?: string;   // display name used in the PDF header
  logoUrl?: string;     // optional logo (future use)
  email: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;    // supports {formTitle} and {_uuid} placeholders
  };
};
```

This is independent of the existing `emailNotification` key — a form can have both, one, or
neither configured.

### Hook changes (`src/routes/hook.ts`)

Inside the `waitUntil` block, after all AI/geocode enrichment steps have completed and the
fully-enriched submission object is assembled, add a PDF step:

```ts
if (pdfReport) {
  const pdfResult = await generateAndEmailPdf(
    pdfReport,
    enrichedSubmission,
    c.env.RESEND_API_KEY,
    c.env.RESEND_FROM_EMAIL
  );
  logEntry.pdfOk = pdfResult.ok;
  if (!pdfResult.ok) logEntry.pdfError = pdfResult.error;
}
```

### New helper: `src/lib/pdfReport.ts`

```ts
export async function generateAndEmailPdf(
  cfg: PdfReportConfig,
  submission: Record<string, unknown>,
  resendApiKey: string,
  fromEmail: string
): Promise<{ ok: boolean; error?: string }>
```

Steps:
1. `POST {serviceUrl}/render` with `{ template, data: submission, meta: { formTitle, ... } }`
2. If response is not `application/pdf`, log and return `{ ok: false }`
3. Convert the PDF `ArrayBuffer` to Base64
4. Call Resend `/emails` with the `attachments` array:

```json
{
  "attachments": [{
    "filename": "submission-{_uuid}.pdf",
    "content": "<base64>",
    "content_type": "application/pdf"
  }]
}
```

Resend supports attachments via `content` (Base64 string) + `content_type` in its v1 API.
Subject line placeholder substitution (`{_uuid}`, `{formTitle}`) happens here before sending.

### `src/types.ts` — LogEntry addition

```ts
pdfOk?: boolean;
pdfError?: string;
```

---

## Configure page

Add a "PDF Report" section to the form configure UI (same pattern as existing sections):

- `Service URL` — text input
- `Template` — text input, placeholder "submission"  
- `Form title` — text input for the PDF header
- `Email to` — comma-separated addresses
- `Email subject` — text input
- Save button → `POST /api/configure/forward` (reuses the existing config endpoint, which
  merges changes into the stored JSON)

---

## Deployment

### docker-compose snippet for the server

```yaml
services:
  typst-doc-service:
    build: ./typst-doc-service
    restart: unless-stopped
    ports:
      - "127.0.0.1:3100:3000"   # bind localhost only; reverse-proxy via nginx if needed
    environment:
      PORT: "3000"
      API_SECRET: "${TYPST_API_SECRET}"   # optional auth header check
```

Keep the service off the public internet. kobo2logie (Cloudflare Worker) reaches it via an
outbound call to `http://your-vps-ip:3100` (or a domain name). Add a simple `Authorization:
Bearer {API_SECRET}` header check in the Node server if the port must be reachable from outside
a private network.

### Fly.io / Railway option

If not self-hosting, the same Docker image can be deployed to Fly.io as a private app in the
same region as a target platform. The service URL would then be the Fly internal DNS name.

---

## Logging

- Success: log `[pdf] rendered ${template} for ${_uuid} — ${bytes} bytes, emailed to ${to}`
- Typst compile error: log the full stderr from the child process
- Network failure (can't reach service): log and set `pdfOk: false` — never throw
- All logging goes through `console.error` / `console.log` — visible in Cloudflare Worker logs

---

## Summary Reports — Future Architecture Notes

This section records design intent for when summary reports are built out. No code in the initial
build needs to accommodate this — the new service endpoint is a clean addition.

### Trigger options

| Method | Pros | Cons |
|---|---|---|
| Cloudflare Cron Triggers | Native to Workers, no extra infra | Workers have a 30s CPU limit per invocation |
| External cron (cPanel, VPS crontab) | Simple, no limit | Separate scheduling system |
| Cloudflare Workflows (beta) | Handles long-running steps | Newer, less battle-tested |

For a low-frequency report (weekly/monthly), an external cron on the VPS calling a Worker
endpoint (`POST /api/reports/summary`) is the simplest path.

### Data source

The current buffer is ephemeral (in-memory DO, cleared on idle). Summary reports require
persistent data. Options at the time of building this out:

1. **Fetch from Kobo API at report time** — `GET {server}/api/v2/assets/{uid}/data/` with
   pagination. No additional storage in kobo2logie. Best for infrequent reports over a modest
   dataset size.

2. **Cloudflare D1** — add a SQLite-backed submission store to the Worker. Writes happen in
   `hook.ts`; the summary trigger queries D1 for the date range. More infrastructure but keeps
   everything within the Worker.

3. **External Postgres** — same VPS as the geocoder. The hook POSTs to an additional endpoint
   on the VPS that stores the enriched submission. The summary job queries Postgres directly.

Option 1 is the lowest-lift starting point and avoids adding storage to kobo2logie.

### Summary template (`templates/summary.typ`)

Will be a stub in the initial build. The final version should include:
- Submission count + date range header
- Per-question response distribution tables
- Numeric field statistics (min, max, median, stddev)
- Key/value pair frequency counts for select-one and select-multiple questions
- Maps section (static image if a geocoder map export endpoint exists, else omitted)
- Typst has a `cetz` package for basic charting if simple bar charts are needed

### `/render/summary` endpoint additions

Compared to `/render`, this endpoint needs to:
- Accept `submissions: Record<string, unknown>[]` (array)
- Optionally accept a pre-computed `aggregates` object to avoid recomputing in Typst
- Set a higher process timeout (may take a few seconds for large datasets)
- Stream-write the PDF if the dataset is very large (Typst is single-pass and will buffer anyway)

---

## Files to Create/Change

### New repository: `typst-doc-service/`

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build; installs Typst CLI |
| `docker-compose.yml` | Local dev + server deployment |
| `package.json` | Node deps: `hono`, `@hono/node-server` |
| `tsconfig.json` | ESM, Node20 target |
| `src/index.ts` | HTTP server |
| `src/render.ts` | Render logic, executes Typst |
| `src/types.ts` | `RenderRequest`, `RenderMeta` |
| `templates/submission.typ` | Single-submission PDF template |
| `templates/summary.typ` | Stub file (future) |

### Changes to kobo2logie

| File | Change |
|---|---|
| `src/types.ts` | Add `pdfOk?: boolean`, `pdfError?: string` to `LogEntry` |
| `src/lib/pdfReport.ts` | **New** — `generateAndEmailPdf()` |
| `src/routes/hook.ts` | Parse `pdfReport` from config; call `generateAndEmailPdf` in `waitUntil` block |
| `src/routes/configure.ts` | `pdfReport` fields added to config schema (the endpoint already accepts arbitrary JSON) |
| `src/routes/ui.ts` | PDF Report section on the configure page |
| `wrangler.toml` | No changes needed — no new bindings |
