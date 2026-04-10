# Plan: Audio Transcription via OpenAI Whisper

**TL;DR:** When a form submission has audio attachments and transcription is enabled for that form, fetch the audio from Kobo, send it to the OpenAI Whisper API, and inject the resulting transcript into the JSON payload before forwarding to the external service.

---

## Context & Constraints

- **Runtime is Cloudflare Workers** — no Node.js `pydub`, no FFmpeg, no audio chunking. The splitting logic from `run.py` cannot be ported directly.
- **OpenAI Whisper limit** — 25 MB per request. For MVP, skip transcription and log a warning if the audio file is too large; chunking is a future enhancement.
- **Fire-and-forget** — transcription happens inside `waitUntil`, same as the rest of the forwarding pipeline. A slow transcription delays the forwarded POST but never blocks the 200 response back to Kobo.
- **Model** — default `gpt-4o-mini-transcribe`. `gpt-4o-transcribe` is also available as a higher-accuracy option. Make it configurable per-form.
- **No SDK** — call OpenAI's REST API directly via `fetch` with `multipart/form-data` (same pattern used by the existing Kobo attachment fetch).
- **Forwarding is a prerequisite** — transcription only runs when a `forwardUrl` is set. There's no use case for transcribing without forwarding.

---

## New per-form config shape

`FORWARD_CONFIG` KV entries will gain an optional `transcribe` object. Existing entries without it keep working unchanged.

```ts
{
  forwardUrl?: string;
  forwardToken?: string;
  fields?: string[];
  // NEW:
  transcribe?: {
    questions: string[];  // list of question names (question_xpath values) to transcribe
                         // each produces a "<question_name>_transcript" key in the JSON
    model?: string;      // OpenAI model, default: "gpt-4o-mini-transcribe"
  };
}
```

Example — a form with two audio questions `audio_intro` and `audio_notes` would produce:
```json
{
  "audio_intro": "recording1.m4a",
  "audio_intro_transcript": "Hello, my name is...",
  "audio_notes": "recording2.m4a",
  "audio_notes_transcript": "The situation on the ground..."
}
```

---

## Phase 1 — Secrets & Env

1. Add `OPENAI_API_KEY` as a Wrangler secret:
   ```bash
   wrangler secret put OPENAI_API_KEY
   ```
2. Add `OPENAI_API_KEY: string` to the `Env` interface in `src/types.ts`.
3. No `wrangler.toml` changes needed (secrets are not declared there).

---

## Phase 2 — `src/lib/transcribe.ts` (new file)

Single exported function:

```ts
export async function transcribeAudio(
  audioBlob: Blob,
  filename: string,
  openaiApiKey: string,
  model = "gpt-4o-mini-transcribe"
): Promise<string>
```

Implementation:
- Guard: if `audioBlob.size > 25 * 1024 * 1024` log a warning and return `""` (skip silently so forwarding still completes).
- Build a `FormData` with:
  - `"file"` → `new File([audioBlob], filename, { type: audioBlob.type })`
  - `"model"` → `model`
  - `"response_format"` → `"text"`
- POST to `https://api.openai.com/v1/audio/transcriptions` with `Authorization: Bearer {openaiApiKey}`.
- Return the response text (OpenAI returns plain text when `response_format=text`).
- On any error, log via `console.error` and return `""` — never throw (fire-and-forget safe).

---

## Phase 3 — Integrate into `src/lib/forward.ts`

`forwardSubmission` gains two new optional parameters:

```ts
export async function forwardSubmission(
  submission: KoboSubmission,
  forwardUrl: string,
  koboBaseUrl: string,
  tokens: { global: string; eu: string },
  jsonPayload?: Record<string, unknown>,
  forwardToken?: string,
  // NEW:
  transcribeConfig?: { questions: string[]; model?: string },
  openaiApiKey?: string
): Promise<void>
```

Transcription step, inserted **before** the `FormData` is built:

1. If `transcribeConfig` and `openaiApiKey` are provided and `transcribeConfig.questions` is non-empty:
   a. Build a lookup map of all audio attachments keyed by `question_xpath`: filter `submission._attachments` for non-deleted entries with `mimetype.startsWith("audio/")`.
   b. For each question name in `transcribeConfig.questions`:
      - Find the matching attachment from the map (by `question_xpath`).
      - If no match, log a warning and skip that question.
      - Fetch the audio blob from Kobo using the resolved `token`.
      - Call `transcribeAudio(blob, filename, openaiApiKey, model)`.
      - If a non-empty transcript is returned, inject it into the working payload under `"<questionName>_transcript"`.
   c. All questions are fetched and transcribed in parallel (`Promise.all`) to keep latency reasonable when there are multiple.
2. The working payload starts as `jsonPayload ?? { ...submission }` and is mutated with transcript keys before being passed to the `FormData` build.
3. Continue with the existing `FormData` build + POST as normal.

---

## Phase 4 — Update `src/routes/hook.ts`

In the block that parses `fwdConfig` and calls `forwardSubmission`:

- Destructure `transcribe` from the parsed config:
  ```ts
  const { forwardUrl, forwardToken, fields, transcribe } = JSON.parse(fwdConfig);
  ```
- Pass it and `c.env.OPENAI_API_KEY` as the new trailing args to `forwardSubmission`.
- Guard: only pass `openaiApiKey` if `c.env.OPENAI_API_KEY` is a non-empty string, so forms without the secret set degrade gracefully.

No other changes to `hook.ts`.

---

## Phase 5 — Update `src/routes/configure.ts`

Add handling in the existing `POST /api/configure/forward` endpoint (or a new endpoint if cleaner):

- Accept optional `transcribe` object in the request body.
- Validate: `questions` is an array of non-empty strings; `model` is a string or absent.
- Merge into the KV entry alongside existing fields.
- To disable transcription: client sends `transcribe: null` → strip the key before saving.

---

## Phase 6 — Configure UI (`src/routes/ui.ts`)

In the forwarding configuration section of the settings page, add a collapsible or simple subsection:

- **"Transcribe audio"** checkbox — enables/disables the block; hiding it also clears the saved config.
- **Questions to transcribe** — a dynamic tag-style input where the user types a question name and presses Enter/comma to add it to a list. Each tag shows the question name and an × to remove it. The underlying value is an array of strings sent as `transcribe.questions`.
- **Model** select: `gpt-4o-mini-transcribe` (default) | `gpt-4o-transcribe`.
- "Save transcription settings" button — calls `POST /api/configure/forward` with the merged payload.

Display note: below the tag input, show a preview of the output keys that will be added, e.g. `audio_intro → audio_intro_transcript`.

---

## Phase 7 — Testing checklist

- [ ] Form with no audio → forwarding unchanged (no `transcribe` key in config).
- [ ] Single question configured, matching attachment present → `<question>_transcript` appended to forwarded JSON.
- [ ] Multiple questions configured → each produces its own `_transcript` key; all run in parallel.
- [ ] One question has no matching attachment → that question skipped, others still transcribed.
- [ ] Audio file > 25 MB → warning logged, that transcript skipped, forwarding still sends with remaining transcripts.
- [ ] `OPENAI_API_KEY` not set → guard in `hook.ts` skips all transcription gracefully, forwarding unaffected.
- [ ] Transcription disabled (checkbox off) → `transcribe` key removed from KV, subsequent submissions not transcribed.

---

## Out of scope / future work

- **Chunking** — the `run.py` silence-based chunking for >25 MB audio. Would require streaming audio processing not currently viable in Workers without Workers AI or an external service.
- **Workers AI** — Cloudflare's own Whisper model (`@cf/openai/whisper`). Would eliminate the OpenAI API key dependency and cost. Switch is straightforward once the `transcribe.ts` interface is in place.
- **Transcript in viewer** — showing transcripts highlighted in the browser WebSocket viewer alongside the JSON.
- **Language hints** — passing `language` to OpenAI Whisper for better accuracy.
