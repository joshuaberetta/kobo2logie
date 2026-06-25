# Concept Note: WhatsApp-Native Data Collection via KoboToolbox

## Purpose of This Document

This note describes a software component — a Cloudflare Worker that bridges KoboToolbox and WhatsApp — for inclusion in a larger grant concept note. It is written for an LLM synthesizer and is intentionally structured for extraction: each section is self-contained, claims are qualified by implementation status, and technical terminology is precise rather than promotional.

---

## Problem Statement

KoboToolbox is the dominant open-source platform for humanitarian data collection. Its primary data-entry interfaces — KoboCollect (Android) and Enketo web forms — require either a smartphone with a dedicated app or reliable browser access. In low-resource field contexts, these assumptions frequently fail:

- Enumerators often own only basic Android phones without storage capacity for additional apps.
- Browser-based forms require stable data connections and are poorly suited to intermittent connectivity.
- WhatsApp, by contrast, has near-universal smartphone penetration in Sub-Saharan Africa, South Asia, and Latin America — the primary geographies of humanitarian data collection. It works reliably on low-bandwidth connections, caches conversation history offline, and is already the primary communication tool for field teams.

The gap: there is no production-ready, open-source bridge between KoboToolbox's form infrastructure and WhatsApp as a data-entry surface.

---

## Solution Summary

**kobo-whatsapp-bot** is an open-source Cloudflare Worker (TypeScript) that turns any KoboToolbox XLSForm into a WhatsApp conversation. It supports two interaction modes:

1. **Structured mode** — The form's questions are delivered one-by-one via WhatsApp. Answers are validated against XLSForm constraints before advancing. Skip logic is evaluated so irrelevant questions are silently omitted. On completion, answers are submitted to KoboToolbox as a standard OpenRosa XML submission indistinguishable from a KoboCollect submission.

2. **Chat mode** (`/chat` command) — An LLM (GPT-4.1) conducts a free-form conversational interview, dynamically gathering form fields in natural dialogue. The LLM detects the user's language and responds in kind. When all required fields are collected, a separate extraction pass re-reads the conversation to build the final answer dictionary, which follows the same submission path as structured mode.

Both modes produce identical outputs: a valid OpenRosa XML submission to `kc.kobotoolbox.org/api/v1/submissions`, with media files (images, audio) attached as multipart form parts.

---

## Architecture

```
Respondent (WhatsApp)
        │
        ▼
Twilio WhatsApp (webhook POST per message)
        │
        ▼
Cloudflare Worker  ─────────────────────────────────────────────────────────────
  │                                                                              │
  ├── src/index.ts          Webhook handler, command dispatch (/stop /restart /chat)
  ├── src/session.ts        KV-backed session CRUD, 24-hour TTL
  ├── src/chatSession.ts    KV-backed chat session (conversation history)
  ├── src/formEngine.ts     Skip logic evaluator, answer validator, normaliser
  ├── src/chatEngine.ts     System prompt builder, OpenAI API caller, answer extractor
  ├── src/koboClient.ts     Kobo API wrapper, OpenRosa XML builder, submission sender
  └── src/messageBuilder.ts WhatsApp message formatter, Twilio REST API caller
        │
        ├── Cloudflare KV       Session state (per phone number, 24h TTL)
        ├── KoboToolbox API     GET /api/v2/assets/{uid}.json  (form schema)
        ├── kc.kobotoolbox.org  POST /api/v1/submissions       (data submission)
        ├── Twilio REST API     Outbound WhatsApp messages
        └── OpenAI API          GPT-4.1 (chat mode only)
```

**Runtime:** Cloudflare Workers (V8 isolates, globally distributed, no server to provision). No Node.js runtime dependencies — all I/O uses native `fetch`, `FormData`, and `KVNamespace`.

**Infrastructure cost:** Cloudflare Workers free tier covers 100,000 requests/day. KV storage is free up to 1 GB. At typical survey volumes (hundreds to low thousands of submissions/month), infrastructure cost is effectively zero.

---

## Data Flow

### Structured Mode

1. Respondent sends any WhatsApp message → Twilio POSTs to `/webhook`
2. Worker looks up session in Cloudflare KV by phone number
3. If no session: fetch form schema from KoboToolbox API, parse questions, create session, send welcome message + first question
4. If session exists: validate the incoming answer against the current question's type and constraint; on failure, re-send the question with an error; on success, store answer and advance
5. Advance logic: evaluate each subsequent question's `relevant` expression against the answer dict; skip questions that evaluate false; send the next applicable question
6. When the last question is answered: translate answers from field-name keys to XPath keys, build OpenRosa XML, POST as multipart to KoboToolbox, delete session, send confirmation

### Chat Mode

1. `/chat` command: fetch form schema, build LLM system prompt enumerating all fields, types, required status, and choice options; call GPT-4.1 with `[BEGIN]` to generate opening message; save conversation history to KV
2. Each subsequent message: append to history, call GPT-4.1, relay response to user
3. When GPT-4.1 outputs `SUBMIT:{...}`: run an independent extraction pass over the raw user messages only (ignoring assistant turns) to build a clean answer dict; merge with the primary answer dict; validate required fields
4. Submit via same path as structured mode

---

## Question Type Support

| XLSForm type | Structured mode behaviour | Stored value format |
|---|---|---|
| `text` | Free-text reply | Raw string |
| `integer` / `decimal` | Numeric reply, format validated | String of number |
| `select_one` | Numbered choice list; user replies with digit | XLSForm choice `name` |
| `select_multiple` | Numbered list; space-separated digits | Space-separated `name` values |
| `date` | Accepts DD/MM/YYYY or YYYY-MM-DD | `YYYY-MM-DD` |
| `note` | Text sent; auto-advances with no reply | _(omitted from submission)_ |
| `geopoint` | User shares WhatsApp location pin | `"lat lon 0 0"` |
| `image` | User sends photo; downloaded and stored as base64 | Filename; file attached as multipart |
| `audio` | User sends voice note; downloaded and stored | Filename; file attached as multipart |

Not currently supported: `repeat` groups, `calculate` fields, cascade selects, multiple form languages (always uses first language label).

---

## Skip Logic Implementation

The `evaluateRelevant()` function implements a subset of XLSForm skip logic sufficient for the majority of real-world forms:

- `${fieldName}` references are substituted with the stored answer value (quoted)
- `and` / `or` / `=` / `!=` are translated to JavaScript equivalents
- `selected(${field}, 'value')` is handled as a substring check
- The resulting expression string is evaluated with `eval()`

This covers simple conditional expressions (`${consent} = 'yes'`, `${age} > 18`) but does not handle the full XPath 1.0 function library (`count()`, `position()`, `concat()`, etc.). A roadmap item exists to replace this with a lightweight XPath evaluator. Expressions that fail to evaluate default to showing the question (safe failure).

---

## Submission Format

Submissions use the OpenRosa multipart POST format accepted by `kc.kobotoolbox.org/api/v1/submissions` — the same endpoint used by KoboCollect and Enketo. The XML root element tag matches the KoboToolbox asset UID, and the submission carries standard OpenRosa metadata (`instanceID`, `__version__`, `start`, `end`). Submissions appear in KoboToolbox's data views and exports identically to submissions from any other collection method.

---

## Current Implementation Status

**Implemented and tested (45 unit tests passing):**
- Full structured mode: schema parsing, skip logic, all supported question types, answer validation, OpenRosa submission
- Chat mode: system prompt construction, GPT-4.1 conversation loop, dual-pass answer extraction, submission
- Session management: KV CRUD, 24h TTL, in-memory `MessageSid` deduplication
- Media handling: Twilio CDN download, base64 KV storage, multipart reattachment
- Commands: `/stop`, `/restart`, `/chat`
- Health check endpoint

**Known limitations (documented, not blocking for MVP):**
- Skip logic does not cover full XPath 1.0 (complex expressions fall back to showing the question)
- Session state uses Cloudflare KV (eventually consistent); rare duplicate submissions possible under Twilio retry storms
- Media stored as base64 in KV values; capped at 25 MB per session
- One form per deployment (`KOBO_ASSET_UID` env var)
- Twilio request signature (HMAC-SHA1) not yet verified — any HTTP client can POST to the webhook endpoint
- XML debug logging currently enabled (logs full submission XML to Cloudflare console)

---

## Deployment Model

The system runs as a single Cloudflare Worker with:
- One Cloudflare KV namespace for session state
- One Twilio WhatsApp sandbox number (or dedicated number for production)
- One KoboToolbox project (form UID configured via environment variable)

Deployment is a single `wrangler deploy` command. No servers, no containers, no infrastructure management. Production secrets are stored in Cloudflare's encrypted secrets store. New versions deploy globally in seconds with zero downtime.

For production use, the main prerequisite beyond the MVP is applying for a dedicated Twilio WhatsApp number (removes the sandbox join-code requirement). This is a Twilio process requiring Meta approval; it takes 1–4 weeks.

---

## Roadmap (Prioritised)

The following items are documented in the project's future feature backlog, ordered by effort-to-impact ratio:

**Low effort / high impact:**
- WhatsApp Quick Reply buttons for `select_one` with ≤3 choices (eliminates a class of validation errors)
- Progress indicator on each question ("Question 3 of 12")
- `/status` command (show answers so far, remaining question count)
- Resume prompt for stale sessions (user dropped off and returned)

**Moderate effort:**
- Multi-language label support (per-session language selection, index into `label[n]`)
- Multi-form configuration (`KOBO_FORMS` env var mapping slugs to asset UIDs)
- Repeat group support (`begin_repeat`/`end_repeat`)
- Replace `eval()`-based skip logic with a purpose-built XPath subset evaluator
- Twilio request signature verification

**Higher effort / architectural:**
- Migrate session state to Cloudflare Durable Objects for strong consistency and durable deduplication
- Submission retry queue (Cloudflare Queues) for resilience against Kobo API downtime
- Multi-tenant configuration (one Worker deployment serving multiple organisations)
- Submission analytics / audit log to Cloudflare R2

---

## Dependencies and Licensing

**Runtime dependencies:** None. All functionality uses Cloudflare Workers native APIs (`fetch`, `FormData`, `crypto`, `KVNamespace`).

**Dev dependencies:** TypeScript, Wrangler (Cloudflare CLI), Vitest. All MIT-licensed.

**External services:**
- Twilio (WhatsApp API) — pay-per-message; free sandbox for development
- KoboToolbox — open-source; free hosted tier at kf.kobotoolbox.org; self-hostable
- OpenAI API — pay-per-token; required only for chat mode
- Cloudflare Workers — free tier covers typical NGO survey volumes

**Codebase:** Open source, TypeScript, ~1,000 lines of application code across 8 modules. Structured for readability and modification by developers unfamiliar with Cloudflare Workers.

---

## Integration Context Notes for LLM Synthesizer

- This component is a **data collection interface**, not a data platform. It writes to KoboToolbox; analysis, dashboards, and reporting happen in KoboToolbox or downstream from it.
- It is **form-agnostic**: any XLSForm that avoids repeat groups and does not rely on complex XPath functions will work without code changes.
- The **chat mode** is the differentiating capability. It removes all structured interface friction: no numbered menus, no validation loops, no language barrier. An LLM-mediated conversation can handle ambiguous answers, multi-answer messages, and mid-conversation language switches — dramatically lowering the cognitive load for low-literacy or first-time respondents.
- The **dual-mode architecture** is intentional: structured mode is appropriate when enumerators are filling forms on behalf of respondents (fast, deterministic, validated), while chat mode is appropriate for self-administered surveys where respondent experience is the priority.
- This is an **edge-deployed, zero-infrastructure** solution. Operational overhead after initial setup is close to zero — no servers to patch, no databases to back up, no processes to restart.
