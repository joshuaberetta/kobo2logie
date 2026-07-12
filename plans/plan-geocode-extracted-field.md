# Plan: Geocode a Field Extracted During Image Analysis

## Context

The app can already forward-geocode **existing** text questions as addresses via
`geocodeAddressFields` (see [plan-geo.md](plan-geo.md) and `hook.ts` → `geocodeAddress()`).

Separately, the **Analyze (image)** step (`extract`) runs OCR/vision over an image
attachment and writes back a set of output fields defined in the config modal
(KEY → WHAT TO EXTRACT). One of those extracted fields is often an address (e.g. a
paper form's "Location address" line).

**Goal:** let the user mark one (or more) of the extracted output fields as an
*address*, so its extracted value is run through the same forward-geocoding pipeline
(`geocodeAddress()` → `_latitude`, `_longitude`, `_adm{n}_pcode`, `_adm{n}_name`).

This applies equally to the **Analyze (text)** (`extractText`) and **Analyze (audio)**
(`analyzeAudio`) steps, which share the exact same prompt-field structure — but the
image case is the driver.

---

## Current architecture (relevant slice)

```
hook.ts
 ├─ geocode (geopoint → reverse geocode)         → geoFields          [BEFORE forward]
 ├─ geocodeAddressFields (existing text Qs)      → addressGeoFields   [BEFORE forward]
 ├─ enrichedPayload = submission + geoFields + addressGeoFields
 └─ forwardSubmission(...)                                            [enrichment + POST]
        ├─ transcribe
        ├─ analyzeAudio   ─┐
        ├─ extract (image) ─┼─ each writes keys → payload + enrichment{}
        ├─ extractText    ─┘
        ├─ POST enrichedPayload+enrichment to forwardUrl
        └─ returns { enrichment, steps }
      → edit-back writes enrichment{} to Kobo
```

**Key facts discovered:**

- `extractFields()` (`src/lib/extract.ts`) returns a flat `Record<string,string>`;
  keys come straight from the config's field `key` values.
- Extraction happens **inside** `forwardSubmission` (`src/lib/forward.ts:256`), so
  extracted values do **not** exist when hook.ts runs `geocodeAddressFields`.
  → Geocoding an *extracted* field must run **after extraction**.
- The prompt-field type **already carries an unused `type?: string`** slot in the
  hook.ts config type (`hook.ts:200-202`), but `forward.ts` narrows it to
  `PromptField = { key: string; instruction: string }` and never reads it.
  This is the natural place to hang a `geocode` flag.
- `geocodeAddress()` (`src/lib/geocode.ts:72`) already returns the correctly-named
  `_latitude` / `_longitude` / `_adm{n}_pcode` / `_adm{n}_name` map and never throws.
- Existing prefix convention: address geocode keys are written as
  `${xpath}${k}` (e.g. `location_address_latitude`). We follow the same pattern,
  prefixing with the extracted field's **key**.

---

## Design

### Where the geocoding runs — inside `forward.ts`, right after extraction

We geocode the extracted value **inside `forwardSubmission`**, immediately after the
`extract` / `extractText` / `analyzeAudio` block populates `payload`/`enrichment`.

Rationale:
- The extracted value only exists after that block runs.
- Doing it here means the resulting `_adm*` fields land in **both** the forwarded
  payload (`payload`) *and* the `enrichment{}` map (so edit-back writes them to Kobo),
  matching how every other enrichment key already flows.
- Alternative (geocode in hook.ts on the returned `enrichment`) would exclude the
  P-codes from the forwarded POST body and duplicate geocode wiring. Rejected.

### Config shape — per-field `geocode` flag

Reuse the existing `fields` array on each prompt entry. Add an optional boolean:

```ts
type PromptField = {
  key: string;
  instruction: string;
  geocode?: boolean;   // NEW — run this extracted value through geocodeAddress()
};
```

Chosen over the vestigial `type?: string` because a boolean is unambiguous and won't
collide with any future "field type" (date/number) semantics. If `type?` is preferred
for forward-compat, use `type === "address"`; note this in review.

### Enrichment key naming

For an extracted field with key `address` whose geocode succeeds:

```
address                    = "123 Main St, Nampula"   (the extracted value itself)
address_latitude           = "-15.11"
address_longitude          = "39.26"
address_adm0_pcode         = "MZ"
address_adm0_name          = "Mozambique"
address_adm1_pcode         = "MZ11"
...
```

i.e. prefix = the extracted field `key`, suffix = the keys returned by
`geocodeAddress()` (which already start with `_`). Mirrors `geocodeAddressFields`.

---

## Implementation steps

### 1. `src/lib/forward.ts`

- Widen `PromptField` to include `geocode?: boolean`.
- After each of the three enrichment blocks (`extract`, `extractText`, `analyzeAudio`)
  writes its keys, collect the set of `(key)` values whose prompt-field has
  `geocode === true` for that question, and for each such key that produced a
  non-empty string value:
  - call `geocodeAddress(value.trim())`
  - write each returned `_*` field into `payload` and `enrichment` under
    `${key}${geokey}`.
- Factor this into a small local helper to avoid repeating it three times, e.g.:

  ```ts
  async function geocodeExtractedFields(
    prompts: PromptMap | undefined,
    questionName: string,
    extracted: Record<string, string>,
    payload: Record<string, unknown>,
    enrichment: Record<string, string>,
  ): Promise<string[]>  // returns keys written, for step logging
  ```

- Record geocode outcome in the step result. Two options:
  - (a) extend the existing `EnrichmentStepResult.keys` to include the geocode keys
    (simplest — they just show as more written keys), **or**
  - (b) add a dedicated per-field geocode sub-result.
  Recommend (a) for the first cut; the keys array already communicates success.

- `geocodeAddress` is imported from `./geocode.js` (currently only imported in hook.ts).

### 2. `src/routes/configure.ts`

- In the extract/analyzeAudio/extractText validation blocks (three near-identical
  loops at ~312, ~349, ~387), preserve the new per-field `geocode` flag when building
  `safeFields`:

  ```ts
  const geocode = (f as Record<string, unknown>).geocode === true;
  if (key) acc.push({ key, instruction, ...(geocode ? { geocode: true } : {}) });
  ```

- Widen the three `safe*` local types and the request-body destructure type
  (`fields: Array<{ key; instruction; geocode? }>`) accordingly.
- Update the GET config response type (~211-213) to include `geocode?`.

### 3. `src/routes/hook.ts`

- Widen the `extract`/`analyzeAudio`/`extractText` config types in the `JSON.parse`
  cast (~200-202) to include `geocode?: boolean` on fields. No orchestration change —
  forward.ts does the work and returns the keys in `steps`.

### 4. Frontend (config modal) — `frontend/` is built React; source not in this repo

> ⚠️ Only `frontend/dist` (compiled bundle) is present. The React **source** lives
> elsewhere. The plan below describes the source change; whoever owns the frontend
> repo implements it. If the intent is to edit the served UI directly, note that
> `src/routes/ui.ts` renders a *different* inline-HTML config surface — confirm which
> UI is actually in use for this project before implementing.

In the **Output fields** table of the Analyze modal, add a small control per row
(next to the `×` delete button), e.g. a checkbox or a 📍 toggle:
"Geocode as address". When checked, the row's field object carries `geocode: true`.
Persist it in the `prompts[xpath].fields[]` payload sent to `PUT /configure`.

UI copy suggestion: a compact checkbox labelled **"Geocode"** with tooltip
"Run this extracted value through the address geocoder to derive lat/lon and admin
P-codes."

### 5. Logging / UI display of results

- The log viewer already renders `extractSteps` / `extractTextSteps` /
  `analyzeAudioSteps` with their `keys`. Since geocode keys are appended to those
  `keys` arrays (option 2a), no log-schema change is required for a first cut.
- Optional polish: if a dedicated geocode sub-result is added, extend `types.ts`
  `EnrichmentStepResult` and the log renderer.

### 6. Backfill / retry

- `src/routes/backfill.ts` and `src/routes/retry.ts` re-invoke the same hook path via
  the SELF binding, so they inherit this behavior with **no change**. Verify the
  config they replay includes the new `geocode` flag (it will, since it's persisted in
  the same `prompts` structure).

---

## Edge cases & decisions

- **Extracted value empty / field not produced** → skip geocoding silently (the
  extract step already records "No fields extracted"). No geocode key written.
- **Address not resolvable** → `geocodeAddress` returns `{}`; write nothing. Consider
  logging `{ ok:false, error:"Address could not be geocoded" }` at the field level if
  a dedicated sub-result is added; otherwise no-op.
- **Multiple geocodable fields per question** → supported; each prefixes with its own
  key. Two address fields won't collide.
- **Same key geocoded across image + text steps** → last writer wins in `payload`;
  acceptable, but warn in review if both target the same key.
- **Coordinate-format extracted values** (e.g. someone extracts "lat lon") → out of
  scope; this feature forward-geocodes free-text addresses only. The existing
  geopoint `geocode` path handles coordinates.
- **Rate/latency** → each geocodable field adds one HTTP round-trip to the geocoder,
  run after extraction. Keep them in the existing `Promise.all` per-question fan-out
  so they don't serialize across questions.

---

## Testing

- Unit: extend `forward.ts` tests (if any under `vitest`) with a mocked
  `geocodeAddress` to assert `${key}_latitude` etc. land in both `payload` and
  `enrichment`, and in the returned `steps.extract[q].keys`.
- Config round-trip: `PUT /configure` with a field `{ key, instruction, geocode:true }`
  then `GET` returns it intact.
- Manual E2E (via `/verify` or a real submission): submit an image with an address,
  confirm the Kobo submission gets `address_adm1_name` etc. edited back, and the
  forwarded payload contains them.

---

## Files touched

| File | Change |
|---|---|
| `src/lib/forward.ts` | Widen `PromptField`; geocode flagged extracted fields; import `geocodeAddress` |
| `src/routes/configure.ts` | Persist + validate per-field `geocode` flag (3 blocks); widen types |
| `src/routes/hook.ts` | Widen extract/analyzeAudio/extractText config types |
| `src/types.ts` | (optional) extend `EnrichmentStepResult` if adding a dedicated geocode sub-result |
| frontend source (external repo) | Per-row "Geocode as address" toggle in the Analyze modal |

## Out of scope

- Geocoding provider changes (see [plan-geocode.md](plan-geocode.md)).
- Reverse geocoding of extracted coordinate pairs.
- Conditional gating of extracted-field geocoding (the existing `geocodeCondition`
  gates the geopoint path only; add later if needed).
