# Geolocator: Capability Overview

## Purpose

Geolocator is a stateless, edge-deployed web service that converts free-text location descriptions into precise geographic coordinates. It is designed specifically for humanitarian field workers who describe sites using vague language, local landmarks, and non-standard place names rather than formal addresses. The system is optimised for contexts where standard geocoding fails — remote areas, multilingual environments, and low-infrastructure settings.

---

## Core Problem Being Solved

Field workers in humanitarian operations (health, WASH, logistics, protection) routinely describe site locations in ways that conventional maps and geocoding tools cannot process: "the clinic behind the market, about 3km north of Butembo," or "water point next to the large mosque in the eastern quartier." These descriptions are often in French, Arabic, Swahili, or English mixed with local place names. Geolocator bridges this gap by combining large language model extraction with geographic search APIs to produce a best-estimate coordinate from any natural language description.

---

## Functional Capabilities

### Text Input Geocoding

Users submit a free-text description of a location (10–1,000 characters) via a browser form or REST API. The system processes the description through a three-stage pipeline and returns a latitude/longitude coordinate pair, a formatted address, a confidence level, and supporting detail.

### Voice Input with Transcription

Users can record a spoken location description directly in the browser. The audio is transcribed using OpenAI Whisper (`whisper-1`), which auto-detects language and is prompted with field-specific vocabulary (landmarks, cardinal directions, humanitarian site terminology). The transcription appears in the form for review and editing before geocoding. Supports 99+ languages; 25 MB audio limit per recording.

### Three-Stage Intelligence Pipeline

**Stage 1 — LLM Extraction (GPT-4o):** The raw description is parsed into a structured object containing a cleaned search query, an anchor place name, an inferred facility type (clinic, school, water point, etc.), a spatial offset (direction, reference landmark, distance), an administrative context (country, region), a detected language, and a confidence rating. The model runs at temperature 0 for deterministic output and never invents or translates place names.

**Stage 2 — Geographic Search (Google Places API, three-tier fallback):**
1. **Text Search** on the cleaned primary query. Returns up to 3 candidate places.
2. **Nearby Search** (if Text Search returns nothing): geocodes the anchor place, then searches within the extracted offset radius filtered by facility type.
3. **Anchor Geocoding only** (if both above fail): geocodes the anchor place name alone and returns its coordinates with a degraded confidence flag.

At each fallback step a human-readable warning is added to the response explaining the strategy used.

**Stage 3 — LLM Re-ranking (GPT-4o):** When Stage 2 returns multiple candidates, a second GPT-4o call compares them against the original description — evaluating semantic name match, place type alignment, geographic plausibility from directional cues, and local naming conventions. Candidates are reordered with the best match first. If re-ranking fails or times out, the original Places ordering is preserved and the result is still returned.

### Response Enrichment

Every response includes:
- Best-match coordinates, formatted address, and Google Place ID
- Confidence level: `high`, `medium`, `low`, or `failed`
- Source tag indicating which pipeline stage produced the result (`places_text`, `places_nearby`, `fallback_geocode`, `failed`)
- Full list of candidate places with coordinates
- Raw extraction object (query, anchor, place type, spatial offset, detected language, ambiguity notes)
- Whether re-ranking was applied
- Human-readable warnings for each fallback step taken
- Per-stage processing times in milliseconds

### Multilingual Support

Both text and voice inputs work across 100+ languages. Whisper handles language auto-detection for voice. The LLM extraction detects the description language and preserves local place name spellings without translation, which is critical for matching against Google Places entries that use local-language names.

### Humanitarian Domain Optimisation

The re-ranking prompt instructs the model to prefer health facilities, water points, schools, and official compound locations over commercial establishments when candidates are otherwise equivalent. The extraction prompt is trained to handle common field description patterns: cardinal directions, distance-from-landmark descriptions, administrative hierarchy references, and misspelled or abbreviated local names.

---

## Interface Options

### Browser UI

A self-contained single-page interface served at the Worker root URL. Features include:
- Textarea for description input with six pre-filled multilingual example chips
- Record/Stop button for voice input with live transcription review
- Submit button with processing state
- Results card showing address, confidence badge, source tag, and copyable coordinates
- Collapsible candidate table and raw extraction viewer for debugging
- Warning list for fallback steps
- Processing time footer
- Responsive design, mobile-friendly

### REST API

The same Worker serves a JSON API for programmatic access:

- `GET /geolocate?description=...` — geocode via query string
- `POST /geolocate` with `{ "description": "..." }` JSON body — geocode via POST
- `POST /transcribe` with audio file upload — transcribe audio to text
- `GET /` — serve the browser UI

All endpoints include CORS headers (`Access-Control-Allow-Origin: *`), making them usable from any browser-based field tool or mobile web app.

---

## Technology Stack

| Component | Technology |
|---|---|
| Runtime / deployment | Cloudflare Workers (edge, globally distributed, stateless) |
| LLM extraction + re-ranking | OpenAI GPT-4o |
| Voice transcription | OpenAI Whisper (`whisper-1`) |
| Geographic search | Google Places API (New) — Text Search, Nearby Search, Geocoding |
| Browser audio capture | HTML5 MediaRecorder API (WebM/Opus) |
| Client interface | Vanilla HTML/CSS/JavaScript, no framework dependencies |
| Testing | Vitest with full pipeline mocking |

---

## Deployment & Integration

The system deploys as a single Cloudflare Worker with two API secrets (`OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`). Deployment is a single `wrangler deploy` command. Rate limiting is configured through Cloudflare WAF rules (recommended: 60 requests per 60 seconds per IP). There is no application-level authentication by design; access control is managed at the infrastructure layer.

The stateless architecture means the API can be called from mobile apps, field data collection tools (KoboToolbox, ODK, DHIS2), mapping platforms, or any HTTP client. Because there is no server-side state, it scales horizontally and can be used in intermittent-connectivity workflows where descriptions are queued offline and submitted in batch when connectivity is restored.

Per-request API cost is approximately $0.01–$0.02 at moderate volume.

---

## Graceful Degradation

The system is designed to always return something useful rather than fail hard:
- If extraction yields low confidence, the response flags it and continues rather than aborting
- If Text Search fails, Nearby Search runs automatically
- If Nearby Search fails, anchor geocoding runs
- If re-ranking fails or times out, the original candidate ordering is used
- All degradation steps are surfaced to the user as warnings, not silent failures

This makes the system suitable for field use where partial information is better than no information.

---

## Limitations

- No built-in request caching or deduplication (repeated identical queries incur full API costs)
- No server-side result persistence or audit logging (calling application must handle this)
- Voice recordings are limited to 25 MB by Whisper's hard constraint (not a practical issue for field use — typical clips are 10–60 seconds)
- No built-in authentication (relies on Cloudflare WAF for abuse prevention)
