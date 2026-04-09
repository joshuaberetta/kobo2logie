# Integration guide — kobo2logie as middleware

This document describes how to extend kobo2logie from a passive viewer into an active middleware layer that reshapes KoboToolbox submissions and forwards them to a target platform, with minimal per-form configuration.

---

## The core idea

Every form submission already arrives at:

```
POST /api/hook/:formUID
```

The `formUID` is the only identifier in play. Everything else — the form schema, the field names, the attachments — is in the JSON body Kobo sends. This makes `formUID` the natural key for routing and configuration: store what you need to know about a form under that key, look it up when a webhook arrives, and forward accordingly.

No per-form code changes. No redeployment per form. One config entry per form, written once.

---

## Data flow (target architecture)

```
Kobo form submitted
  │
  ▼
POST /api/hook/:formUID
  │
  ├─→ Durable Object (existing) — real-time viewer (unchanged)
  │
  └─→ Transform layer
        │
        ├─ Look up form config from KV (formUID → { targetUrl, fieldMap, ... })
        ├─ Resolve attachment URLs (download from Kobo or rewrite as proxied URLs)
        ├─ Reshape payload to target schema
        │
        └─→ POST to target platform webhook URL
```

The viewer and the forwarding pipeline run in parallel — the same incoming webhook feeds both.

---

## Configuration model

Store one config record per form in **Cloudflare KV**. The key is the `formUID`, the value is JSON:

```json
{
  "targetUrl": "https://your-platform.example.com/webhook",
  "koboToken": "your-kobo-api-token",
  "fieldMap": {
    "name":          "respondent_name",
    "age":           "respondent_age",
    "image_of_site": "_attachments[0]"
  },
  "includeRawPayload": false,
  "resolveMedia": "download"
}
```

| Field | Description |
|---|---|
| `targetUrl` | Where to POST the reshaped submission |
| `koboToken` | Kobo API token for downloading attachments (can be a Worker secret instead) |
| `fieldMap` | Optional: map Kobo field names → target field names |
| `includeRawPayload` | Whether to include the full original Kobo JSON alongside the reshaped data |
| `resolveMedia` | `"download"` (fetch from Kobo and re-upload or base64), `"proxy"` (rewrite to `/api/media` URLs), or `"raw"` (leave Kobo URLs as-is) |

**Adding a new form** = one `wrangler kv:key put` command. No code changes. No redeployment.

```bash
wrangler kv:key put --binding=FORM_CONFIG "a6LDoopohAy6s2Vw9gWo8p" '{
  "targetUrl": "https://your-platform.example.com/webhook",
  "koboToken": "abc123"
}'
```

---

## Payload transformation

### What Kobo sends

A raw Kobo submission looks like this (abbreviated):

```json
{
  "_id": 719641374,
  "_uuid": "8df3...",
  "_submission_time": "2026-04-08T17:51:00",
  "name": "Josh",
  "age": 34,
  "image_of_site": "photo.jpg",
  "_attachments": [
    {
      "uid": "abc",
      "mimetype": "image/jpeg",
      "question_xpath": "image_of_site",
      "media_file_basename": "photo.jpg",
      "download_url": "https://kf.kobotoolbox.org/api/v2/assets/.../attachments/abc/",
      "download_medium_url": "https://kf.kobotoolbox.org/api/v2/assets/.../attachments/abc/medium/",
      "download_large_url": "https://kf.kobotoolbox.org/api/v2/assets/.../attachments/abc/large/"
    }
  ]
}
```

### What you forward to the target

After reshaping, a cleaned-up outgoing payload might look like:

```json
{
  "respondent_name": "Josh",
  "respondent_age": 34,
  "submitted_at": "2026-04-08T17:51:00",
  "form_uid": "a6LDoopohAy6s2Vw9gWo8p",
  "submission_id": 719641374,
  "attachments": [
    {
      "field": "image_of_site",
      "filename": "photo.jpg",
      "mimetype": "image/jpeg",
      "url": "https://your-worker.workers.dev/api/media?url=...&token=...&base=..."
    }
  ]
}
```

---

## Media handling strategies

This is the most important design choice. Three options:

### 1. Proxy URLs (simplest, token visible to target)

Rewrite each attachment URL to go through `/api/media`. The target platform fetches images on demand. The Kobo token is embedded in the query string.

**Best for:** targets you control, where token exposure in URLs is acceptable.

### 2. Download and forward (most compatible, highest Worker CPU)

In the hook handler, fetch each attachment from the Kobo API using your token, then either:
- Include it as a base64 `data:` URI in the forwarded payload (works for small images, no extra request from target)
- Upload it to R2 or another object store and forward the public URL (cleanest for the target, requires R2 binding)

**Best for:** targets that don't support auth headers for media, or where you want media decoupled from Kobo's servers.

### 3. Raw Kobo URLs (no extra work, but token required by target)

Forward `download_url` as-is. The target must include `Authorization: Token <kobo-token>` when fetching images.

**Best for:** internal targets that can be given the token directly.

---

## Implementation steps

### 1. Add KV namespace

In `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FORM_CONFIG"
id = "your-kv-namespace-id"
```

Create it:

```bash
wrangler kv:namespace create FORM_CONFIG
```

### 2. Add `FORM_CONFIG` to the `Env` interface

In `src/types.ts`:

```ts
export interface Env {
  FORM_SESSION: DurableObjectNamespace;
  FORM_CONFIG: KVNamespace;           // add this
  DEFAULT_KOBO_BASE_URL: string;
  MAX_BUFFER_SIZE: string;
  MAX_BODY_BYTES: string;
}
```

### 3. Extend `hook.ts` to look up config and forward

After the existing DO push, add a non-blocking forward:

```ts
// Fire-and-forget forward (don't await — don't block the 200 OK to Kobo)
c.executionCtx.waitUntil(forwardToTarget(c.env, formUID, body as KoboSubmission));
```

Implement `forwardToTarget`:

```ts
async function forwardToTarget(env: Env, formUID: string, submission: KoboSubmission) {
  const raw = await env.FORM_CONFIG.get(formUID);
  if (!raw) return; // no config for this form — skip

  const config = JSON.parse(raw);

  // Build the outgoing payload
  const payload: Record<string, unknown> = {
    form_uid: formUID,
    submission_id: submission._id,
    submitted_at: submission._submission_time,
  };

  // Apply field map
  if (config.fieldMap) {
    for (const [koboField, targetField] of Object.entries(config.fieldMap)) {
      payload[targetField as string] = submission[koboField];
    }
  }

  // Resolve attachments
  const attachments = (submission._attachments ?? []).filter(a => !a.is_deleted);
  payload.attachments = attachments.map(a => ({
    field: a.question_xpath,
    filename: a.media_file_basename,
    mimetype: a.mimetype,
    url: rewriteMediaUrl(a.download_medium_url, config),
  }));

  if (config.includeRawPayload) {
    payload._raw = submission;
  }

  await fetch(config.targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
```

### 4. Register a form

```bash
wrangler kv:key put --binding=FORM_CONFIG "a6LDoopohAy6s2Vw9gWo8p" '{
  "targetUrl": "https://your-platform.example.com/incoming",
  "resolveMedia": "proxy",
  "fieldMap": {
    "name": "respondent_name",
    "age": "respondent_age"
  }
}'
```

That's it. The next Kobo submission for that form will be forwarded automatically.

---

## Multi-form routing

Because every form hits the same Worker with its `formUID` in the URL, routing is automatic. Each form can have:
- A different `targetUrl` (route submissions from different forms to different endpoints)
- A different `fieldMap` (reshape each form's schema independently)
- A different `resolveMedia` strategy

Forms with no KV entry are simply not forwarded — the viewer still works for them.

---

## Zero-config auto-registration (optional)

If you want truly zero setup per form, add a fallback: if no KV config exists for a `formUID`, write a default entry on first receipt and forward to a global catch-all webhook. This means the first submission from any new form automatically starts being forwarded.

```ts
if (!raw) {
  const defaultConfig = { targetUrl: env.DEFAULT_TARGET_URL, resolveMedia: "proxy" };
  await env.FORM_CONFIG.put(formUID, JSON.stringify(defaultConfig));
  config = defaultConfig;
}
```

Add `DEFAULT_TARGET_URL` to `wrangler.toml` `[vars]`.

---

## Target platform requirements

For the simplest integration, the target platform needs only:
- An HTTP endpoint that accepts `POST` with `Content-Type: application/json`
- Ability to display or store arbitrary JSON fields
- For media: ability to render `<img src="...">` from the proxied or R2 URLs

Platforms that work well out of the box: Airtable (via their REST API), Notion (database pages), any custom web app, Zapier/Make webhooks, or a second Cloudflare Worker.

---

## Security considerations

- Store the Kobo token as a **Worker secret** (`wrangler secret put KOBO_TOKEN`) rather than in KV, so it never appears in logs or config exports.
- Validate the `targetUrl` from KV against an allowlist of known hostnames before fetching, to prevent a compromised KV entry from turning the Worker into an open forwarder.
- The hook endpoint is unauthenticated — consider adding a shared secret header that Kobo sends and your Worker validates, to reject spurious POSTs before they reach the forward logic.
