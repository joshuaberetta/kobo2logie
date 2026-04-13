# Plan: AI Submission Validation

## Goal

Add an **AI validation** step that reviews a Kobo submission and sets its validation status (`approved`, `not_approved`, or `on_hold`) via the Kobo API. Optionally writes the AI's reasoning back to the submission as `_ai_validation_reasoning`.

---

## Kobo validation status API

```
PATCH {server}/api/v2/assets/{uid}/data/{_id}/validation_status/
Authorization: Token {token}
Content-Type: application/x-www-form-urlencoded

validation_status.uid=validation_status_approved
  | validation_status_not_approved
  | validation_status_on_hold
```

`_id` is the numeric submission ID, already resolved by `resolveSubmissionId()` — reuse it instead of calling the lookup twice when both `editOriginal` and `validateSubmission` are enabled.

---

## Config shape

Add one new field to the stored `FORWARD_CONFIG` JSON:

```ts
validateSubmission?: {
  instructions: string;              // overall context prompt
  includeReasoning: boolean;         // write _ai_validation_reasoning back
  options: {
    approved: string;                // description of what qualifies as Approved
    notApproved: string;             // description of what qualifies as Not Approved
    onHold: string;                  // description of what qualifies as On Hold
  };
}
```

---

## New helper: `src/lib/validateSubmission.ts`

Exports one function:

```ts
export async function callValidationAI(
  apiKey: string,
  submission: Record<string, unknown>,
  instructions: string,
  options: { approved: string; notApproved: string; onHold: string }
): Promise<{ decision: "approved" | "not_approved" | "on_hold"; reasoning: string } | null>
```

Builds a system prompt along the lines of:

```
You are a submission reviewer. Review the following submission and decide on its validation status.

Overall context: <instructions>

Criteria:
- Approved: <options.approved>
- Not Approved: <options.notApproved>
- On Hold: <options.onHold>

Respond with valid JSON only:
{"decision":"approved"|"not_approved"|"on_hold","reasoning":"<explanation>"}
```

Uses `gpt-4o-mini` (same model as other AI steps). Parses the JSON response; returns `null` on failure.

---

## `src/lib/koboEdit.ts` — new export

Add `updateValidationStatus()` alongside the existing helpers:

```ts
export async function updateValidationStatus(
  server: string,
  uid: string,
  id: number,
  status: "validation_status_approved" | "validation_status_not_approved" | "validation_status_on_hold",
  token: string
): Promise<{ ok: boolean; httpStatus: number; error?: string }>
```

Issues:

```
PATCH {server}/api/v2/assets/{uid}/data/{id}/validation_status/
Content-Type: application/x-www-form-urlencoded
Body: validation_status.uid=<status>
```

---

## `src/types.ts` — `LogEntry` additions

```ts
validateOk?: boolean;        // true = status set, false = failed, absent = not attempted
validateHttpStatus?: number;
validateError?: string;
```

---

## `src/routes/configure.ts` changes

### `GET /api/configure/project/:uid`

Add `validateSubmission` to the config type cast and to the returned JSON:

```ts
validateSubmission: config.validateSubmission ?? null,
```

### `POST /api/configure/project/:uid`

Accept `validateSubmission` in the request body type and persist it (with sanitisation):

```ts
let safeValidate: typeof validateSubmission | undefined;
if (validateSubmission != null) {
  safeValidate = {
    instructions: String(validateSubmission.instructions ?? "").trim(),
    includeReasoning: !!validateSubmission.includeReasoning,
    options: {
      approved:    String(validateSubmission.options?.approved    ?? "").trim(),
      notApproved: String(validateSubmission.options?.notApproved ?? "").trim(),
      onHold:      String(validateSubmission.options?.onHold      ?? "").trim(),
    },
  };
}
```

---

## `src/routes/hook.ts` changes

### Config destructure

Add `validateSubmission` to the parsed config object.

### waitUntil block — `_id` resolution de-duplication

When both `editOriginal` and `validateSubmission` are enabled, `resolveSubmissionId()` is called once and the result reused for both operations.

Concretely: resolve `submissionId` before starting either the edit or validation step, whenever either feature is active.

### Step 2 (edit) — unchanged logic, same variable

Reuse already-resolved `submissionId`.

### New Step 3 — validate

```ts
let validateOk: boolean | undefined;
let validateHttpStatus: number | undefined;
let validateError: string | undefined;

if (validateSubmission && server && submission._uuid && openaiApiKey) {
  // resolve _id if not already done above
  const valId = submissionId ?? await resolveSubmissionId(server, formUID, submission._uuid, koboToken);
  if (valId !== null) {
    const aiResult = await callValidationAI(
      openaiApiKey,
      submission as Record<string, unknown>,
      validateSubmission.instructions,
      validateSubmission.options
    );
    if (aiResult) {
      const statusMap = {
        approved:    "validation_status_approved",
        not_approved:"validation_status_not_approved",
        on_hold:     "validation_status_on_hold",
      } as const;
      const valResult = await updateValidationStatus(
        server, formUID, valId, statusMap[aiResult.decision], koboToken
      );
      validateOk = valResult.ok;
      validateHttpStatus = valResult.httpStatus;
      validateError = valResult.error;

      // Optionally write reasoning back to the submission
      if (validateSubmission.includeReasoning && aiResult.reasoning) {
        await editSubmission(server, formUID, valId, { _ai_validation_reasoning: aiResult.reasoning }, koboToken);
      }
    } else {
      validateOk = false;
      validateError = "AI returned no result";
    }
  } else {
    validateOk = false;
    validateError = "Could not resolve _id from _uuid";
  }
}
```

Log fields spread into `logEntry` the same way as `editOk`.

---

## `src/routes/ui.ts` changes

### 1. Advanced Settings — Actions group

Below the existing "Edit original submission" checkbox block, add:

```html
<div>
  <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
    <label class="checkbox-row">
      <input type="checkbox" id="validate-submission" autocomplete="off" />
      <span>Validate submission with AI</span>
    </label>
    <button type="button" class="select-btn" id="validate-configure-btn" style="display:none"
            onclick="openValidateModal()">Configure&hellip;</button>
  </div>
  <p class="label-hint" style="margin-top:.3rem;margin-left:1.55rem">
    Use AI to review the submission and set its validation status (Approved, Not Approved, On Hold) in KoboToolbox.
    Requires API token configured during setup.
  </p>
</div>
```

Show/hide the Configure button the same way as the email Configure button:  
toggle on `change` of the `#validate-submission` checkbox.

### 2. Validation config modal

New modal placed alongside the other modals (`#prompt-modal`, `#email-modal`):

```html
<div class="modal-overlay" id="validate-modal" onclick="closeValidateOverlay(event)">
  <div class="modal" style="max-width:520px">
    <div class="modal-header">
      <span class="modal-title">AI validation settings</span>
      <button type="button" class="modal-close" onclick="closeValidateModal(false)">&times;</button>
    </div>
    <div class="modal-body" style="gap:.9rem">

      <div>
        <label for="validate-instructions" style="...">
          Instructions
          <span class="label-hint">overall context to give the model</span>
        </label>
        <textarea id="validate-instructions" rows="3"
          placeholder="e.g. This is a field assessment completed by a data collector..."></textarea>
      </div>

      <!-- Fixed three options — each with a description -->
      <div>
        <label style="...">Approved<span class="label-hint">describe what qualifies</span></label>
        <textarea id="validate-opt-approved" rows="2"
          placeholder="e.g. All required fields are filled and responses are consistent..."></textarea>
      </div>
      <div>
        <label style="...">Not Approved<span class="label-hint">describe what qualifies</span></label>
        <textarea id="validate-opt-not-approved" rows="2"
          placeholder="e.g. Critical fields are missing or responses contradict each other..."></textarea>
      </div>
      <div>
        <label style="...">On Hold<span class="label-hint">describe what qualifies</span></label>
        <textarea id="validate-opt-on-hold" rows="2"
          placeholder="e.g. Minor issues that require follow-up before full approval..."></textarea>
      </div>

      <!-- Reasoning checkbox -->
      <div style="border:1.5px solid #e5e7eb;border-radius:8px;padding:.65rem .75rem">
        <label class="checkbox-row" style="margin-bottom:0">
          <input type="checkbox" id="validate-include-reasoning" autocomplete="off" checked />
          <span style="font-size:.85rem;font-weight:600;color:#444">Include reasoning in submission</span>
        </label>
        <p style="font-size:.78rem;color:#6b7280;margin:.3rem 0 0 1.55rem">
          Writes the AI's explanation back to the submission as
          <code>_ai_validation_reasoning</code>.
        </p>
      </div>

      <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
        <button type="button" class="select-btn" onclick="closeValidateModal(false)">Cancel</button>
        <button type="button" class="save-btn" style="width:auto;padding:.45rem 1rem"
                onclick="closeValidateModal(true)">Save</button>
      </div>
    </div>
  </div>
</div>
```

### 3. JavaScript additions

```js
// State
let validateConfig = null; // { instructions, includeReasoning, options:{approved,notApproved,onHold} }

function openValidateModal() {
  const cfg = validateConfig || {};
  document.getElementById('validate-instructions').value = cfg.instructions || '';
  document.getElementById('validate-opt-approved').value = cfg.options?.approved || '';
  document.getElementById('validate-opt-not-approved').value = cfg.options?.notApproved || '';
  document.getElementById('validate-opt-on-hold').value = cfg.options?.onHold || '';
  document.getElementById('validate-include-reasoning').checked =
    cfg.includeReasoning !== false; // default true
  document.getElementById('validate-modal').classList.add('open');
}

function closeValidateModal(save) {
  if (save) {
    validateConfig = {
      instructions: document.getElementById('validate-instructions').value.trim(),
      includeReasoning: document.getElementById('validate-include-reasoning').checked,
      options: {
        approved:    document.getElementById('validate-opt-approved').value.trim(),
        notApproved: document.getElementById('validate-opt-not-approved').value.trim(),
        onHold:      document.getElementById('validate-opt-on-hold').value.trim(),
      },
    };
    markDirty();
  }
  document.getElementById('validate-modal').classList.remove('open');
}

function closeValidateOverlay(e) {
  if (e && e.target !== document.getElementById('validate-modal')) return;
  closeValidateModal(false);
}

// Wire up checkbox → show/hide Configure button
document.getElementById('validate-submission').addEventListener('change', function() {
  document.getElementById('validate-configure-btn').style.display = this.checked ? '' : 'none';
  markDirty();
});
```

### 4. `loadConfig()` additions

```js
if (data.validateSubmission) {
  validateConfig = data.validateSubmission;
  document.getElementById('validate-submission').checked = true;
  document.getElementById('validate-configure-btn').style.display = '';
}
```

### 5. `save()` additions

```js
const validateEnabled = document.getElementById('validate-submission').checked;
const validateSubmission = validateEnabled && validateConfig ? validateConfig : null;
// include in POST body:
body: JSON.stringify({ ..., validateSubmission }),
```

### 6. Log table / detail modal

Add a **Validate** column next to the Edit column:

| Time | UUID | Fwd | Edit | Validate | HTTP | |
|---|---|---|---|---|---|---|
| ... | ... | ✓ | ✓ | ✓ OK | 200 | Details |

Detail modal rows:

- **Validate result**: `✓ Set` / `✗ Failed` / `—`
- **Validate HTTP**: (if attempted)
- **Validate error**: (if failed)

---

## Execution order in `waitUntil`

1. Geocode (unchanged)
2. Forward / enrich (unchanged)
3. **Resolve `_id`** — once, if `editOriginal || validateSubmission`
4. Edit original (unchanged, uses resolved `_id`)
5. **Validate** (new, uses same resolved `_id`)
6. Log (add validate fields)
7. Email (unchanged)

---

## Files changed

| File | Change |
|---|---|
| `src/lib/validateSubmission.ts` | **New** — `callValidationAI()` |
| `src/lib/koboEdit.ts` | Add `updateValidationStatus()` |
| `src/types.ts` | Add `validateOk`, `validateHttpStatus`, `validateError` to `LogEntry` |
| `src/routes/configure.ts` | Accept/return `validateSubmission` in GET+POST `/project/:uid` |
| `src/routes/hook.ts` | Destructure config, de-duplicate `_id` resolution, add validation step |
| `src/routes/ui.ts` | Checkbox + Configure button, modal HTML, JS state/open/close/load/save, log column+detail rows |
