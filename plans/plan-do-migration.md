# Plan: Migrate kobo2logie — Cloudflare Workers → DigitalOcean (Django + React)

## Goal

Replace the Cloudflare Workers/Hono/inline-HTML app with the `poc_template` stack:
Django 5.2 + DRF backend, React 18 + Mantine 7 frontend, PostgreSQL, deployed on DO App Platform.

All external integrations (KoboToolbox API, OpenAI, Resend, geocoder.imtools.info, kobo2pdf.imtools.info) are unchanged — only the runtime platform and language change.

---

## Platform mapping

| Cloudflare concept | DO/Django equivalent |
|---|---|
| `FORWARD_CONFIG` KV namespace | `FormConfig` Django model (JSONField or flat columns) |
| `FormSession` Durable Object (WebSocket hub + SQLite log) | Django Channels consumer + `SubmissionLog` table |
| `executionCtx.waitUntil()` | `threading.Thread(daemon=True)` fired after `return Response(200)` |
| Hono route handlers | DRF `@api_view` functions / ViewSets |
| Wrangler secrets (`.dev.vars`) | DO App Platform env vars / local `.env` |
| Inline HTML SPA (`src/routes/ui.ts`, ~2000 lines) | React pages with Mantine + TanStack Query |
| Worker edge execution | Gunicorn on a DO Basic droplet |

---

## Django models

### `app/models.py`

```python
class FormConfig(models.Model):
    uid = models.CharField(max_length=64, unique=True, db_index=True)
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

class SubmissionLog(models.Model):
    form_uid = models.CharField(max_length=64, db_index=True)
    ts = models.BigIntegerField()           # epoch ms, matches current LogEntry.ts
    uuid = models.CharField(max_length=64)
    submission_id = models.IntegerField(null=True)
    data = models.JSONField(default=dict)   # remaining LogEntry fields as JSON

    class Meta:
        ordering = ['-ts']
        indexes = [models.Index(fields=['form_uid', '-ts'])]
```

`SubmissionLog` stores the same JSON shape as the current `LogEntry` type. The 100-entry cap is enforced in the write helper: after inserting, delete any rows beyond 100 for that `form_uid`.

### Why JSONField for SubmissionLog.data

The LogEntry shape is actively evolving (plan-additional-log-details.md adds step results for every pipeline stage). JSONField avoids repeated migrations as fields are added. Only `form_uid` and `ts` need to be columns for querying.

---

## URL / endpoint mapping

All current routes map 1-to-1. DRF router lives at `/api/`:

| Current (Hono) | New (DRF) | Notes |
|---|---|---|
| `POST /api/hook/:formUID` | `POST /api/hook/<uid>/` | Returns 200 immediately; pipeline runs in thread |
| `GET /api/stream/:formUID` | `ws://…/ws/stream/<uid>/` | Django Channels WebSocket consumer |
| `GET /api/media` | `GET /api/media/` | Pass-through proxy, SSRF guard unchanged |
| `GET /api/configure/project/:uid` | `GET /api/configure/project/<uid>/` | Returns `FormConfig.config` |
| `POST /api/configure/project/:uid` | `POST /api/configure/project/<uid>/` | Saves to `FormConfig` |
| `GET /api/configure/survey/:uid` | `GET /api/configure/survey/<uid>/` | Proxies Kobo asset API |
| `POST /api/configure/condition/generate` | `POST /api/configure/condition/generate/` | AI condition generation |
| `POST /api/retry/:formUID` | `POST /api/retry/<uid>/` | Re-fetches from Kobo + re-runs pipeline |
| `GET /api/logs/:formUID` | `GET /api/logs/<uid>/` | Paginated `SubmissionLog` read |
| `GET /` and `GET /:uid` | React SPA (`/` and `/:uid`) | Served by React Router, not Django |

The Django `config/urls.py` catchall serves `index.html` for any non-`/api/` path, letting React Router handle `/` and `/:uid` client-side.

---

## Background pipeline — threading approach

The existing pipeline is fire-and-forget via `waitUntil()`. Django replaces this with a daemon thread:

```python
@api_view(['POST'])
def hook(request, uid):
    body = request.data          # parsed by DRF
    config = get_form_config(uid)
    submission = body            # raw Kobo webhook payload

    thread = threading.Thread(
        target=run_pipeline,
        args=(uid, submission, config),
        daemon=True,
    )
    thread.start()
    return Response({'ok': True})

def run_pipeline(uid, submission, config):
    try:
        # mirrors the waitUntil callback in hook.ts
        result = forward_submission(submission, config)
        write_log(uid, submission, result)
        # ... geocode edit-back, email, etc.
    except Exception as e:
        # write failure log entry
        pass
```

This is the simplest approach that requires no new infrastructure. Gunicorn workers are long-lived processes so daemon threads complete normally. The constraint from `poc_template` ("no Celery, keep synchronous") is respected — the thread is an implementation detail, not an external queue.

**Limitation:** If the Gunicorn worker restarts mid-pipeline, the thread is lost with no retry. This matches the existing Cloudflare behavior (the `waitUntil` promise has no retry either). A future Celery migration can be layered on top without changing the pipeline logic.

---

## WebSocket — Django Channels

The `FormSession` DO has three responsibilities:
1. WebSocket hub — broadcast new submissions to all connected viewers
2. In-memory ring buffer — last 50 submissions for initial page load
3. SQLite log — persistent paginated history

### Channels consumer (replaces 1 + 2)

```python
# app/consumers.py
class SubmissionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.uid = self.scope['url_route']['kwargs']['uid']
        self.group = f'form_{self.uid}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group, self.channel_name)

    async def submission_push(self, event):
        await self.send(text_data=event['data'])
```

The pipeline's push step replaces the DO `/push` call:

```python
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

def push_submission(uid, submission_data):
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(
        f'form_{uid}',
        {'type': 'submission.push', 'data': json.dumps(submission_data)},
    )
```

### Channel layer backend

For local dev: `channels.layers.InMemoryChannelLayer` (no Redis needed).
For DO App Platform: add a Redis managed DB ($15/mo) and use `channels_redis.core.RedisChannelLayer`. The `.do/app.yaml` adds a `databases` entry and exposes `REDIS_URL`.

### Ring buffer (last 50 submissions)

The in-memory buffer is only needed for the initial page load. Options:
1. **Redis list** — `LPUSH` on each submission, `LTRIM` to 50, `LRANGE` on connect. Simple, requires Redis.
2. **`SubmissionLog` query** — on connect, send the latest 50 log rows. Slightly different data shape but functionally equivalent.

Option 2 is recommended: it requires no extra Redis operations and the `SubmissionLog` table already holds the data. On WebSocket connect, the consumer queries `SubmissionLog.objects.filter(form_uid=uid)[:50]` and sends them before joining the group.

---

## Python pipeline — porting from TypeScript

Each lib file in `src/lib/` becomes a Python module in `app/lib/`:

| TypeScript | Python | Notes |
|---|---|---|
| `forward.ts` | `app/lib/forward.py` | `httpx` (or `requests`) replaces `fetch`; `python-multipart` for multipart assembly |
| `transcribe.ts` | `app/lib/transcribe.py` | `openai` Python SDK, `gpt-4o-mini-transcribe` |
| `extract.ts` | `app/lib/extract.py` | `openai` Python SDK, vision messages |
| `analyzeAudio.ts` | `app/lib/analyze_audio.py` | Transcribe + structured extraction |
| `extractText.ts` | `app/lib/extract_text.py` | OpenAI chat completion |
| `geocode.ts` | `app/lib/geocode.py` | `httpx` calls to `geocoder.imtools.info` |
| `koboEdit.ts` | `app/lib/kobo_edit.py` | `resolveSubmissionId` + `editSubmission` |
| `validateSubmission.ts` | `app/lib/validate_submission.py` | OpenAI completion → Kobo validation status |
| `pdfReport.ts` | `app/lib/pdf_report.py` | `httpx` call to `kobo2pdf.imtools.info` |
| `evaluateCondition.ts` | `app/lib/evaluate_condition.py` | Pure function, direct port of 12 operators |
| `submissionValue.ts` | `app/lib/submission_value.py` | XPath value resolver |
| `kobo.ts` (SSRF guard) | `app/lib/kobo.py` | `is_private_ip()` check before any proxy fetch |

**Dependency additions to `requirements.txt`:**
```
openai>=1.0
httpx>=0.27
resend>=2.0        # or requests-based Resend client
channels>=4.0
channels-redis>=4.0
daphne>=4.0        # ASGI server for Channels
```

**ASGI vs WSGI:** Django Channels requires ASGI. Replace Gunicorn with Daphne (or Uvicorn + Django Channels) in the run command:

```yaml
# .do/app.yaml
run_command: daphne config.asgi:application --bind 0.0.0.0 --port $PORT
```

Update `config/asgi.py` to wire in the Channels routing:

```python
application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    'websocket': URLRouter([path('ws/stream/<uid>/', SubmissionConsumer.as_asgi())]),
})
```

---

## Environment variables

Current Wrangler vars/secrets → DO App Platform env vars:

| Wrangler | DO env var | Notes |
|---|---|---|
| `KOBO_API_TOKEN_GLOBAL` | `KOBO_API_TOKEN_GLOBAL` | |
| `KOBO_API_TOKEN_EU` | `KOBO_API_TOKEN_EU` | |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | |
| `RESEND_API_KEY` | `RESEND_API_KEY` | |
| `RESEND_FROM_EMAIL` | `RESEND_FROM_EMAIL` | |
| `LOGIE_API_URL` / `LOGIE_API_KEY` | `LOGIE_API_URL` / `LOGIE_API_KEY` | optional |
| `DEFAULT_KOBO_BASE_URL` | `DEFAULT_KOBO_BASE_URL` | |
| `MAX_BUFFER_SIZE=50` | `MAX_BUFFER_SIZE=50` | or hardcode |
| `MAX_BODY_BYTES=1048576` | `MAX_BODY_BYTES=1048576` | |
| `SECRET_KEY` (Django) | `SECRET_KEY` | new, set in DO secrets |
| `DATABASE_URL` | `DATABASE_URL` | injected by DO managed Postgres |
| `REDIS_URL` | `REDIS_URL` | injected by DO managed Redis |

---

## React frontend — page breakdown

The current UI is two pages baked into `src/routes/ui.ts`:

### Page 1: Setup wizard (`/`)
- Kobo base URL selector (global vs EU)
- Kobo API token input
- "Register webhook" button → calls Kobo REST Services API
- "Register permissions" step
- Maps to current `GET /` handler output

### Page 2: Per-form config (`/:uid`)
Currently ~1958 lines of inline HTML/JS covering:
- **Fields subset** — include/exclude questions; transcribe/analyze pills (plan-new-fields-ui.md)
- **Forwarding** — URL, token, media types, condition builder
- **Geocoding** — geopoint field, address fields, condition
- **AI enrichment** — transcription, image extraction, audio analysis, text extraction configs with prompt editors
- **Edit original** — toggle + server/token fields
- **Response field mappings** — for GitHub Issues case management
- **AI validation** — model, prompt, condition
- **Email notification** — from/to/subject/body/AI body/PDF/attachments/condition
- **Failure notification** — email config
- **Submission log** — real-time table, WebSocket-fed, with detail modal
- **Real-time viewer** — WebSocket-fed submission preview

Each section maps to a React component using Mantine's form primitives, TanStack Query for config load/save, and the existing Mantine kobo theme from `poc_template`.

**Suggested component structure:**
```
frontend/src/
  pages/
    SetupPage.tsx          # /
    ConfigPage.tsx         # /:uid  (container, sections as children)
  components/config/
    FieldsSection.tsx      # fields subset + enrichment pills
    ForwardingSection.tsx
    GeocodingSection.tsx
    EnrichmentSection.tsx  # transcribe / image / audio / text tabs
    EditOriginalSection.tsx
    ValidationSection.tsx
    EmailSection.tsx
    FailureNotifSection.tsx
    ConditionBuilder.tsx   # shared across multiple sections
  components/log/
    SubmissionLogTable.tsx
    SubmissionDetailModal.tsx
    RealtimeViewer.tsx     # WebSocket consumer
  api/
    configure.ts           # TanStack Query hooks for /api/configure/*
    logs.ts                # hooks for /api/logs/:uid
    hook.ts                # retry POST
```

The `ConditionBuilder.tsx` component replaces the vanilla-JS condition UI that's currently duplicated across forwarding/geocoding/email/validation sections. One component, passed a `value`/`onChange` prop pair.

---

## Config data migration

The KV store holds one JSON blob per form UID. On first launch of the Django app, the KV is inaccessible. Options:

1. **Manual export/import**: Export KV via Wrangler CLI (`wrangler kv:key list` + `get`), write a one-off Django management command that imports the JSON into `FormConfig` rows. Recommended for a clean cutover.
2. **Dual-write period**: Keep the Cloudflare Worker running, add a KV-sync endpoint on the Django side that accepts a bulk upload. Less error-prone for production migrations.

The KV config shape is the same JSON that `FormConfig.config` will store, so no transformation is needed — just a copy.

---

## `.do/app.yaml` additions

The `poc_template` `.do/app.yaml` needs these additions beyond the template default:

```yaml
services:
  - name: api
    routes:
      - path: /api
      - path: /admin
      - path: /static
      - path: /ws        # WebSocket upgrade path
    build_command: pip install -r requirements.txt && python manage.py migrate --noinput && python manage.py collectstatic --noinput
    run_command: daphne config.asgi:application --bind 0.0.0.0 --port $PORT
    envs:
      - key: DEBUG
        value: "False"
      - key: ALLOWED_HOSTS
        value: ".ondigitalocean.app"
      - key: KOBO_API_TOKEN_GLOBAL
        scope: RUN_TIME
        type: SECRET
      # ... other secrets
    instance_size_slug: basic-xxs   # upgrade if pipeline is CPU-bound

databases:
  - name: db
    engine: PG
    version: "16"
  - name: redis
    engine: REDIS

static_sites:
  - name: frontend
    source_dir: frontend
    build_command: npm install && npm run build
    output_dir: dist
    catchall_document: index.html
```

---

## Implementation phases

### Phase 0 — Scaffold (est. 1 day)
- Copy `poc_template` into a new repo (or a new branch of this repo)
- Add `FormConfig` and `SubmissionLog` models + migrations
- Add all env vars to local `.env`
- Verify Django admin shows both models

### Phase 1 — API layer (est. 2–3 days)
- Port all `/api/configure/*` endpoints (KV GET/POST → `FormConfig` CRUD)
- Port `/api/logs/:uid` (SQLite paginated read → `SubmissionLog` query)
- Port `/api/media` proxy with SSRF guard
- Port `/api/retry/:uid`
- Smoke-test each endpoint with curl against a real Kobo form

### Phase 2 — Pipeline (est. 3–4 days)
- Port all `src/lib/*.ts` modules to `app/lib/*.py` (see table above)
- Port `evaluateCondition.ts` → `evaluate_condition.py` (pure logic, easiest to unit-test first)
- Port `forwardSubmission()` → `forward_submission()` with threading
- Wire `POST /api/hook/<uid>/` end-to-end against a real Kobo webhook
- Verify enrichment (transcription, image extraction, geocoding) produces same output

### Phase 3 — WebSocket / Channels (est. 1–2 days)
- Add `channels` and `daphne` to requirements
- Update `config/asgi.py` with ProtocolTypeRouter
- Implement `SubmissionConsumer`
- Wire push call into `run_pipeline`
- Test with the existing WebSocket-based submission viewer logic

### Phase 4 — React frontend (est. 4–5 days)
- `SetupPage` — setup wizard (smaller scope)
- `ConfigPage` container + section components
- `ConditionBuilder` shared component
- `FieldsSection` with enrichment pills (plan-new-fields-ui.md)
- `SubmissionLogTable` + `SubmissionDetailModal` with step results (plan-additional-log-details.md)
- `RealtimeViewer` with WebSocket hook

### Phase 5 — Deploy to DO (est. 0.5 day)
- Update `.do/app.yaml` (Daphne, Redis DB, secrets)
- Push to GitHub, trigger DO App Platform deploy
- Run KV → `FormConfig` import script
- Point Kobo webhook at new DO URL
- Verify end-to-end with a real submission

---

## What does NOT change

- All external API call shapes (KoboToolbox, OpenAI, Resend, geocoder, kobo2pdf)
- The condition engine logic (12 operators, AND/OR groups)
- The config JSON schema stored per form — same keys, same shape, now in Postgres instead of KV
- The `LogEntry` data shape — same fields, now stored in `SubmissionLog.data` JSONField
- SSRF guard logic for the media proxy
- The KoboToolbox REST Service + permission registration flow (setup wizard)
- The GitHub Issues case management feature (plan-case-management.md) — `responseFieldMap` maps directly to `FormConfig.config['responseFieldMap']`

---

## Open questions

1. **Redis vs InMemoryChannelLayer**: For early DO deploy, in-memory channel layer works fine on a single Gunicorn worker. If multiple Gunicorn workers are needed (scale), Redis is required for cross-process channel broadcast. Start with in-memory, add Redis when needed.

2. **Thread-based pipeline vs Celery**: The threading approach is adequate for current load. If pipeline steps become slow enough to exhaust Gunicorn worker threads, Celery + Redis is a natural next step — the `run_pipeline` function signature stays the same.

3. **`gpt-4o-mini-transcribe`**: Check whether this model ID is available in the OpenAI Python SDK at migration time; fall back to `whisper-1` if needed.

4. **Multipart forwarding**: `forward.ts` assembles a multipart/form-data body with Kobo attachments fetched on the fly. `httpx` supports multipart natively; attachment streaming needs care to avoid loading large files fully into memory.

5. **KV export timing**: Decide whether to run dual-write during migration or do a one-time cutover. One-time cutover is simpler if the Cloudflare Worker can be kept live until the DO app is verified.
