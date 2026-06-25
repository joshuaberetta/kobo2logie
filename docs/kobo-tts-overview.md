# KoboTTS — Capabilities Overview

This document describes the capabilities of KoboTTS for inclusion in a concept note. It is intended to be read by an AI agent compiling a broader document.

---

## What the App Is

KoboTTS is a lightweight cloud application (deployed as a Cloudflare Worker) that extends KoboToolbox — the leading open-source platform for humanitarian and development data collection — with two AI-powered workflows:

1. **Automated audio generation**: converts survey question text into natural-sounding speech and embeds audio files directly into forms
2. **Automated form translation**: uses a large language model to translate entire survey forms into new languages

The core problem it solves is accessibility and reach. Many survey respondents in humanitarian and development contexts have low literacy, limited formal education, or speak minority languages not yet supported by existing form translations. KoboTTS removes the manual bottleneck of producing audio-guided surveys and multi-language forms, enabling field teams to deploy more inclusive data collection instruments faster and at lower cost.

---

## Core Features

### 1. Audio Generation

- Converts question labels and hint text into MP3 audio files using OpenAI's text-to-speech API (model: `gpt-4o-mini-tts`)
- Supports **12 distinct voices**: Alloy, Ash, Ballad, Cedar, Coral, Echo, Fable, Marin, Nova, Onyx, Sage, Shimmer — voice is selectable per generation run
- Handles **multilingual forms**: generates separate audio files for each language version of a question, named with ISO language codes
- Detects and displays **existing audio** on each question, so users know what has already been generated
- Supports **selective generation**: users choose which questions to process via checkboxes rather than regenerating the entire form
- Automatically uploads generated audio to KoboToolbox as form media files
- Patches the form definition (XLSForm) to reference the audio files, so they play automatically in KoboCollect and Enketo
- Optionally **redeploys** the updated form immediately to live data collection, without requiring the form designer to log into KoboToolbox

### 2. Form Translation

- Translates all translatable fields in a KoboToolbox form using OpenAI's GPT-4o Mini model
- Translates **survey questions and choice lists** in a single coordinated run, maintaining consistency between question text and answer options
- Handles all standard translatable fields: `label`, `hint`, `constraint_message`, `required_message`, and any others registered in the form's `translated` array
- Supports both **adding a new language** to a form and **overwriting an existing translation**
- Accepts **custom translation instructions** — for example: "use simple language suitable for low-literacy respondents," "use formal register," or "preserve technical terms in English"
- Supports **18 preset languages** in the UI (Amharic, Arabic, Bengali, English, French, Hausa, Hindi, Indonesian, Kinyarwanda, Nepali, Pashto, Portuguese, Somali, Spanish, Swahili, Tigrinya, Turkish, Urdu) plus free-text entry of any ISO 639 language code
- Streams progress to the user in real time so large forms do not appear to hang
- Patches the updated form definition back to KoboToolbox and optionally redeploys to live

### 3. Web Interface

- Fully browser-based single-page application; no installation required
- Users enter their KoboToolbox API token, select a server (KoboToolbox Global, EU server, or any custom URL), and enter a project UID
- A preview table loads all survey questions, showing question names, types, multilingual labels and hints, expandable choice lists, and per-language audio status indicators
- Separate tabs for audio generation and form translation workflows
- Real-time log panel streams progress events as operations complete (successes, skips, and errors)
- Credentials are never stored server-side; the KoboToolbox API token is passed in request headers only

---

## Technical Integrations

| Service | Purpose |
|---|---|
| **KoboToolbox REST API v2** | Fetch form definitions, list/upload/delete media files, patch form content, redeploy forms |
| **OpenAI TTS API** | Generate MP3 audio from text (`gpt-4o-mini-tts`) |
| **OpenAI Chat Completions API** | Translate form fields via JSON-mode responses (`gpt-4o-mini`) |
| **Cloudflare Workers** | Serverless hosting; streams Server-Sent Events to the browser |

---

## End-to-End Workflow

### Audio Generation

1. User loads the form preview — app fetches the form definition and existing media from KoboToolbox
2. User selects questions to process and a voice
3. For each selected question and language, the app calls OpenAI TTS with the question's label and hint text
4. The resulting MP3 is uploaded to KoboToolbox as a form media file; any existing file with the same name is deleted first
5. The app patches the XLSForm definition to reference the new audio filenames in the `media::audio` column
6. If redeploy is enabled, the form is pushed live immediately

### Form Translation

1. User loads the form preview and selects a target language and optional translation instructions
2. App determines whether to add a new language column or overwrite an existing translation
3. For each selected survey row, the app sends all translatable field values as a JSON batch to the LLM and writes the translated values back into the form content
4. The app then translates all choice lists referenced by the selected questions using the same batching approach
5. Updated form content is patched back to KoboToolbox; optionally redeployed

---

## Languages and Formats Supported

- **Audio output format**: MP3
- **Translation languages**: all languages supported by GPT-4o Mini (100+), with 18 humanitarian-context languages as UI presets
- **Form question types**: text, integer, decimal, select_one, select_multiple, date, time, and structural types (groups, repeats)
- **Form source formats**: KoboToolbox XLSForm JSON (the native internal format returned by the KoboToolbox API) — both single-language and multilingual forms

---

## Architecture

KoboTTS is a single Cloudflare Worker written in TypeScript. The browser-based UI is served by the same Worker as a self-contained single-page app (using React and the Mantine component library, bundled inline). All long-running operations stream progress to the browser via Server-Sent Events. There is no database; state lives in the KoboToolbox project itself.

```
Browser (Web UI)
    │
    ├── REST + SSE
    │
    ▼
Cloudflare Worker (TypeScript)
    │
    ├── KoboToolbox API v2  ── fetch/patch/deploy forms; upload/delete media
    └── OpenAI API          ── TTS (audio) + Chat Completions (translation)
```

---

## Deployment and Access

- Deployed as a Cloudflare Worker; accessible via a single URL
- Users supply their own KoboToolbox API token and project UID — no account registration required
- The OpenAI API key is stored as a Cloudflare Worker secret (server-side only; not exposed to users)
- Compatible with KoboToolbox Global (kf.kobotoolbox.org), the OCHA/humanitarian EU server (kobo.humanitarianresponse.info), and self-hosted KoboToolbox instances

---

## Intended Users

KoboTTS is designed for **form designers and field coordinators** working in humanitarian response, development programs, public health, and similar sectors who:

- Build KoboToolbox surveys for populations with low literacy or hearing accessibility needs
- Need to deploy forms in multiple languages without manual translation overhead
- Lack the time or resources to record audio files and manually manage form media
- Work in contexts with a high diversity of spoken languages (e.g., Sub-Saharan Africa, South Asia, the Middle East)
