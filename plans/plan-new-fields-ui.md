# Plan: Fields Subset UI Restructure

## Current state

Each question in the fields list renders as a vertical stack of rows inside a scrollable box:

```
[☐] Question label   /group/xpath
    [✨☐ Transcribe]  →  /group/xpath_transcript      ← audio only
    [✨☐ Analyze] [✎] →  (JSON fields)               ← audio + image + text
```

Audio questions cost **3 rows** each. A form with 15 questions that has 3 audio + 5 image + 4 text fields produces ~35 rows — scrolling is heavy and features are impossible to compare across questions.

**Specific problems:**
1. Vertical pileup — enrichment sub-rows triple the height of eligible questions
2. No horizontal alignment — you can't scan "which questions have Transcribe on" down the list
3. The `→ xpath_transcript` output hints take up space but are rarely referenced
4. Adding a new enrichment type (e.g. geocode, validation) adds another sub-row per eligible question
5. Question type is only implied by which sub-options appear

---

## Approaches considered

### A. HTML `<table>` with feature columns

One row per question. Columns: `Include | Label | Type | Transcribe | Analyze | …`

```
 ☐  Village name           text    —          [Analyze ✎]
 ☐  GPS point              geo     —          —
 ☐  Incident audio         audio   [Transcribe]  [Analyze ✎]
 ☐  Photo of site          image   —          [Analyze ✎]
```

**Pros:** Perfectly scannable, trivially extensible (add a column), sticky header possible  
**Cons:** 640 px card width is tight with 5+ columns once label text wraps; `<table>` layout is inflexible for responsive design; still needs a separate prompt-edit entry point  

---

### B. Accordion expand per question

Main row: `[☐] Question label  [AUDIO] [▶ 1 active]`  
Click → expands below to show enrichment options for that question only.

**Pros:** Zero visual clutter by default  
**Cons:** Hides the configuration state you've already set — you can't see at a glance which questions have enrichment enabled without expanding every row; slow to configure many questions  

---

### C. Feature-first sections (tabs or `<details>` accordions)

Decompose into independent sections:
1. **Fields to forward** — full checklist
2. **Transcription** — checklist of audio questions
3. **Image analysis** — checklist of image questions
4. **Text analysis** — checklist of text questions

**Pros:** Each section is clean and self-contained; adding a feature is adding a section  
**Cons:** Breaks the per-question mental model — user has to correlate across sections ("I see this audio field — now I need to find the transcription section"); repeated question names across sections; poor discoverability of what's available per field type  

---

### D. ★ Recommended — Inline feature pills (one row per question)

Keep the one-row-per-question structure but replace vertical sub-rows with compact **toggle-pill buttons** anchored to the right of each row.

```
 ☐  Incident audio    /group/audio    AUDIO   [Transcribe]  [Analyze ✎]
 ☐  Photo of site     /group/photo    IMAGE                 [Analyze ✎]
 ☐  Notes field       /group/notes    TEXT                  [Analyze ✎]
 ☐  GPS point         /group/gps      GEO
 ☐  Village name      /group/village  TEXT                  [Analyze ✎]
```

Each pill:
- Is a `<button>` with `aria-pressed` and a visually distinct active vs inactive state
- Only shown for eligible question types (audio fields show both; image/text fields show Analyze only; other types show no pills)
- The `✎` prompt indicator lives inside the Analyze pill — becomes a small coloured dot (or pill text changes to `Analyze ●`) when a custom prompt is set; clicking the pill opens the existing prompt modal
- The `→ xpath_transcript` output hints are removed from the list; they appear in the prompt modal header only, where they're actually useful

**Row anatomy:**

```
[☐] [Label (truncated)] [xpath mono grey]  [TYPE BADGE]  [pill] [pill]
 ^        flex: 1            shrink          fixed w      fixed cluster
```

The row is a single `display: flex; align-items: center` container.  
The label area is `flex: 1; min-width: 0` with text-overflow ellipsis.  
The badge + pill cluster is `flex-shrink: 0` so it never wraps.

**Type badges:**

| Question type | Badge |
|---|---|
| `audio` | `AUDIO` — amber |
| `image` / `photo` | `IMAGE` — blue |
| `text` | `TEXT` — slate |
| anything else | _(no badge)_ |

Only types with enrichment options get a badge; the badge is a constant-width `<span>` so pill columns stay aligned even without a grid.

---

## Recommended approach detail

### HTML structure per row

```html
<div class="q-row" data-xpath="/group/audio">
  <input type="checkbox" name="field" value="/group/audio" />
  <span class="q-label">Incident audio</span>
  <span class="q-xpath">/group/audio</span>
  <span class="q-badge q-badge--audio">AUDIO</span>
  <div class="q-pills">
    <button class="q-pill" data-feature="transcribe" aria-pressed="false">Transcribe</button>
    <button class="q-pill" data-feature="analyze" data-type="analyzeAudio" data-has-prompt="false"
            aria-pressed="false">Analyze</button>
  </div>
</div>
```

- No `<label>` wrapping the whole row — the include checkbox gets its own `<label>` or `aria-label`; pills handle their own click
- `data-has-prompt` drives the `●` indicator class via JS; avoids re-rendering the entire list on every prompt save

### CSS pillars

```css
.q-row {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .25rem .4rem;
  border-radius: 6px;
}
.q-row:hover { background: #f9fafb; }

.q-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-xpath { font-family: monospace; font-size: .74rem; color: #9ca3af; flex-shrink: 0; }

.q-badge {
  font-size: .65rem; font-weight: 700; letter-spacing: .04em;
  padding: .1rem .35rem; border-radius: 4px; flex-shrink: 0; width: 3.6rem; text-align: center;
}
.q-badge--audio  { background: #fef3c7; color: #92400e; }
.q-badge--image  { background: #dbeafe; color: #1e40af; }
.q-badge--text   { background: #f1f5f9; color: #475569; }

.q-pills { display: flex; gap: .3rem; flex-shrink: 0; }

.q-pill {
  font-size: .75rem; padding: .15rem .5rem; border-radius: 999px;
  border: 1.5px solid #e5e7eb; background: #fff; color: #6b7280;
  cursor: pointer; white-space: nowrap; position: relative;
}
.q-pill[aria-pressed="true"] {
  background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; font-weight: 600;
}
.q-pill.has-prompt::after {
  content: '●'; font-size: .55rem; color: #2563eb;
  position: absolute; top: -.2rem; right: -.2rem;
}
```

### JS changes

`renderFieldsList()` is rewritten to produce `.q-row` divs instead of nested label+sub-label structure.

Pill click handler (event-delegated on the parent `#fields-list`):
```js
if (target.classList.contains('q-pill')) {
  const feature = target.dataset.feature;
  const pressed = target.getAttribute('aria-pressed') === 'true';
  if (feature === 'analyze') {
    // open the prompt modal (same as current pencil button)
    openPromptModal(row.dataset.xpath, target.dataset.type);
  } else {
    target.setAttribute('aria-pressed', String(!pressed));
    markDirty();
  }
}
```

Note: for the Analyze pill, clicking always opens the prompt modal (which shows the on/off toggle inside). This removes the awkward "checkbox + separate pencil button" combo and makes "enable analyze" and "set instructions" a single intentional action. The pill active state is set when the user saves the prompt modal (even with an empty prompt, the feature is on).

Alternatively, Analyze pill = left-click toggles on/off, a small `✎` inside opens the modal. This preserves the ability to enable Analyze without immediately being asked to write instructions.

**Recommended:** two-zone pill — left ~70% toggles, right `✎` zone opens modal. Simplest version: single click opens modal which has an "Enable" checkbox at the top.

### `getSelected*` helpers

Rewrite to read `aria-pressed` attributes from `.q-pill` elements rather than `:checked` on hidden checkboxes — cleaner source of truth.

---

## Migration scope

| File | Changes |
|---|---|
| `src/routes/ui.ts` | CSS for `.q-row`, `.q-badge`, `.q-pill`; rewrite `renderFieldsList()`; update `getSelectedFields()`, `getSelectedAudioQs()`, `getSelectedExtractQs()`, `getSelectedAnalyzeAudioQs()`, `getSelectedExtractTextQs()`; update change-event handler for audio-analyze→transcribe sync |

No backend changes needed — the existing save/load logic for `configFields`, `configTranscribeQs`, etc. is unaffected.

---

## Extensibility

Adding a future feature (e.g. "Geocode" for GPS fields):
1. Add `q-badge--geo` badge style
2. In `renderFieldsList()`, push a `[Geocode]` pill for `q.type === 'geopoint'` rows
3. Add `getSelectedGeocodeQs()` and wire into the save payload

No structural changes needed.

---

## What to keep from current design

- The collapsible `#fields-list` toggle (▼/▶) and Select all / Deselect all buttons — they work fine, keep them
- The `fields-count` badge showing `N / total`
- The locked `_uuid` row at the top
- The prompt modal itself — only the entry point changes (pill → modal instead of checkbox + pencil)
- The `isDirty` / unsaved-changes warning system
