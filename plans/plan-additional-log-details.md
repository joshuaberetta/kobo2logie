# Plan: Expanded Log Details — Enrichment Steps & Pipeline Results

## Goal

Give operators visibility into what happened at every stage of the processing pipeline, not just whether the final forward succeeded. Currently, individual enrichment failures (transcription, image extraction, audio analysis, text extraction) are silent — they only hit the console and disappear.

---

## Current state

### What the log captures today

| Step | Captured |
|---|---|
| Forward (HTTP result, error, response body) | ✓ |
| Edit-back (ok, httpStatus, error) | ✓ |
| Validation (ok, httpStatus, error) | ✓ |
| PDF generation (ok, error) | ✓ |
| Transcription — did it run? did it succeed? | ✗ |
| Audio analysis — same | ✗ |
| Image extraction — same | ✗ |
| Text extraction — same | ✗ |
| Geocoding — did it run? did it succeed? | ✗ |
| Failure notification — did the alert email send? | ✗ |
| Email notification — did it send? | ✗ |

### What happens to enrichment data today

`forwardSubmission()` returns a `ForwardResult` with an `enrichment` field containing everything the AI steps produced. In `hook.ts`, the log-writing step **explicitly strips it**:

```ts
const { enrichment: _enrichment, ...fwdResultForLog } = fwdResult ?? { ok: true };
```

The individual enrichment steps in `forward.ts` catch their own errors and log to console only — no error information bubbles up.

---

## What to add

### 1. Per-step result tracking in `ForwardResult`

Add an `steps` field to `ForwardResult` in `src/lib/forward.ts`:

```typescript
export interface EnrichmentStepResult {
  ok: boolean;
  error?: string;
  keys?: string[]; // enrichment keys written (e.g. ["obs/observation_transcript"])
}

export interface ForwardResult {
  ok: boolean;
  httpStatus?: number;
  responseBody?: string;
  error?: string;
  enrichment?: Record<string, string>;
  steps?: {
    transcribe?: Record<string, EnrichmentStepResult>;   // keyed by question xpath
    analyzeAudio?: Record<string, EnrichmentStepResult>;
    extract?: Record<string, EnrichmentStepResult>;
    extractText?: Record<string, EnrichmentStepResult>;
  };
}
```

Each enrichment step that runs records its own result in `steps`, keyed by the question xpath. This is lightweight — just booleans, an optional error string, and the list of keys produced.

### 2. Capture step results inside `forwardSubmission()`

In `src/lib/forward.ts`, each enrichment step is already wrapped in a try/catch. Extend those blocks to populate `steps`:

```ts
// transcription example
try {
  const transcript = await transcribeAudio(...);
  if (transcript) {
    enrichment[`${questionName}_transcript`] = transcript;
    steps.transcribe[xpath] = { ok: true, keys: [`${questionName}_transcript`] };
  } else {
    steps.transcribe[xpath] = { ok: false, error: "No transcript returned" };
  }
} catch (err) {
  steps.transcribe[xpath] = { ok: false, error: String(err) };
}
```

Same pattern for `analyzeAudio`, `extract`, and `extractText`.

### 3. Expand `LogEntry` in `src/types.ts`

Add step results and remaining pipeline steps to `LogEntry`:

```typescript
export interface EnrichmentStepResult {
  ok: boolean;
  error?: string;
  keys?: string[];
}

export interface LogEntry {
  // ... existing fields unchanged ...

  // Enrichment steps (absent = step not configured / not attempted)
  transcribeSteps?: Record<string, EnrichmentStepResult>;
  analyzeAudioSteps?: Record<string, EnrichmentStepResult>;
  extractSteps?: Record<string, EnrichmentStepResult>;
  extractTextSteps?: Record<string, EnrichmentStepResult>;

  // Geocoding
  geocodeOk?: boolean;
  geocodeError?: string;

  // Email notification
  emailOk?: boolean;
  emailError?: string;

  // Failure notification
  failureEmailOk?: boolean;
  failureEmailError?: string;
}
```

### 4. Write enrichment step results in `hook.ts`

In the log-writing block, include the steps from `fwdResult`:

```ts
const logEntry: LogEntry = {
  ts: Date.now(),
  uuid: submission._uuid,
  id: submission._id,
  ...fwdResultForLog,
  // enrichment steps
  ...(fwdResult?.steps?.transcribe ? { transcribeSteps: fwdResult.steps.transcribe } : {}),
  ...(fwdResult?.steps?.analyzeAudio ? { analyzeAudioSteps: fwdResult.steps.analyzeAudio } : {}),
  ...(fwdResult?.steps?.extract ? { extractSteps: fwdResult.steps.extract } : {}),
  ...(fwdResult?.steps?.extractText ? { extractTextSteps: fwdResult.steps.extractText } : {}),
  // ... existing edit/validate fields ...
};
```

Also capture geocode, email, and failure email outcomes at the points they currently execute in `hook.ts`.

### 5. Show enrichment steps in the log detail modal (`src/routes/ui.ts`)

Extend `openLogDetail()` to render a pipeline section. Each step group (transcribe, analyzeAudio, extract, extractText) renders as a labelled block with one row per question xpath:

```
Transcription
  obs/observation   ✓  → obs/observation_transcript
  obs/followup      ✗  "Whisper returned empty response"

Image extraction
  obs/photo         ✓  → damage_level, location_description

Geocode           ✓ Written back
Email             ✓ Sent
Edit              ✗ HTTP 403 "Permission denied"
```

A failed step renders in red/muted — same badge pattern as the existing `log-badge fail` class. Steps that didn't run are omitted entirely (absent from `LogEntry`).

---

## Size considerations

Each `EnrichmentStepResult` for a step that succeeds is ~50–150 bytes (ok flag + array of key names). For a typical form with 2–3 enriched fields, the extra data per log entry is well under 1 KB. The 100-entry DO storage limit is unaffected in practice.

If a future form has many enrichment steps, the `keys` array could be omitted (only store ok/error) to keep entries small.

---

## Files to change

| File | Change |
|---|---|
| `src/lib/forward.ts` | Add `EnrichmentStepResult` and `steps` to `ForwardResult`; populate in each try/catch block |
| `src/types.ts` | Add `EnrichmentStepResult` type; expand `LogEntry` with step result fields |
| `src/routes/hook.ts` | Write step results into `logEntry`; capture geocode/email/failureEmail outcomes |
| `src/routes/ui.ts` | Render enrichment step rows in `openLogDetail()` |

---

## Out of scope

- Storing the actual enrichment values (transcripts, AI-extracted text) in the log — these can be large and are already written back to the Kobo submission via `editOriginal`. The goal here is pipeline health visibility, not a data store.
- Changing the 100-entry log limit.
