# Plan: Conditional Logic Engine

## Goal

Add a general-purpose **conditional logic layer** that can gate any configured operation based on the values in a submission. Non-technical users configure conditions through a Notion-style filter UI in the configure page. The same engine applies uniformly to email notifications, forwarding URLs, validation, and any future operation.

---

## Mental model

Each operation in `FORWARD_CONFIG` can optionally carry a `condition` block. When the hook receives a submission, it evaluates that condition against the submission payload before running the operation. If the condition is not met, the operation is skipped silently.

```
submission arrives
  → evaluate condition (if any) for emailNotification
      ✓ passes → send email
      ✗ fails  → skip
  → evaluate condition (if any) for forwardUrl
      ✓ passes → forward
      ...
```

---

## Condition data model

A condition is either a single **rule** or a **group** of rules joined by `AND` / `OR`. Groups can be nested arbitrarily, but the UI will expose at most two levels to keep things manageable (matching Notion's approach).

```ts
type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal";

interface ConditionRule {
  type: "rule";
  field: string;       // submission key / xpath, e.g. "group/question" or "_submission_time"
  operator: Operator;
  value?: string;      // not needed for is_empty / is_not_empty
}

type Combinator = "and" | "or";

interface ConditionGroup {
  type: "group";
  combinator: Combinator;    // how rules within this group are joined
  rules: Array<ConditionRule | ConditionGroup>;
}

// Root type stored in config
type Condition = ConditionGroup;
```

### Example

"Send only if `status` equals `approved` **and** (`region` contains `north` **or** `region` contains `east`)":

```json
{
  "type": "group",
  "combinator": "and",
  "rules": [
    { "type": "rule", "field": "status", "operator": "equals", "value": "approved" },
    {
      "type": "group",
      "combinator": "or",
      "rules": [
        { "type": "rule", "field": "region", "operator": "contains", "value": "north" },
        { "type": "rule", "field": "region", "operator": "contains", "value": "east" }
      ]
    }
  ]
}
```

---

## Where conditions live in `FORWARD_CONFIG`

Each operation gets its own optional `condition` key:

```ts
interface ForwardConfig {
  // ... existing fields ...
  emailNotification?: {
    // ... existing fields ...
    condition?: Condition;
  };
  forwardUrl?: string;
  forwardCondition?: Condition;     // separate top-level key since forwardUrl is a bare string
  validateSubmission?: {
    // ... existing fields ...
    condition?: Condition;
  };
  geocode?: boolean;
  geocodeCondition?: Condition;
  // future operations follow the same pattern
}
```

> **Convention:** For operations whose config is an object (`emailNotification`, `validateSubmission`), nest the `condition` inside. For operations whose config is a primitive (`forwardUrl`, `geocode`), use a sibling `<operationName>Condition` key.

---

## New file: `src/lib/evaluateCondition.ts`

Pure, side-effect-free evaluator. No external deps.

```ts
export function evaluateCondition(
  condition: Condition | undefined,
  submission: Record<string, unknown>
): boolean
```

- If `condition` is `undefined`, returns `true` (no condition = always run).
- A group with zero rules returns `true` (vacuous truth — AND of nothing). This matches the UI behaviour where removing the last rule in a group is equivalent to disabling the condition.
- Recursively evaluates groups by combining child results with the group's `combinator`.
- For each `ConditionRule`:
  - Reads the field value using the same `getPayloadValue()` logic already in `hook.ts` (extract this helper into a shared util — see below).
  - Coerces both operands to strings for comparison operators that need it; to numbers for numeric operators.
  - Returns `true` / `false` per operator semantics.

### Operator semantics

| Operator | Behaviour |
|---|---|
| `equals` | string equality (case-insensitive trim) |
| `not_equals` | inverse of equals |
| `contains` | substring match (case-insensitive) |
| `not_contains` | inverse of contains |
| `starts_with` | prefix match (case-insensitive) |
| `ends_with` | suffix match (case-insensitive) |
| `is_empty` | value is `null`, `undefined`, `""`, or empty array |
| `is_not_empty` | inverse of is_empty |
| `greater_than` | numeric `>` |
| `less_than` | numeric `<` |
| `greater_than_or_equal` | numeric `>=` |
| `less_than_or_equal` | numeric `<=` |

---

## Shared utility: `src/lib/submissionValue.ts`

Extract `getPayloadValue()` out of `hook.ts` into its own file so both `hook.ts` and `evaluateCondition.ts` can import it without duplication:

```ts
export function getPayloadValue(
  payload: Record<string, unknown>,
  key: string
): unknown
```

---

## Hook integration

In `hook.ts`, wrap each operation's execution block with a condition check:

```ts
import { evaluateCondition } from "../lib/evaluateCondition.js";

// email
const emailCond = emailNotification?.condition;
if (emailNotification && evaluateCondition(emailCond, submission)) {
  // ... send email ...
}

// forward
const fwdCond = cfg.forwardCondition;
if (forwardUrl && evaluateCondition(fwdCond, submission)) {
  // ... forward ...
}

// validate
const valCond = validateSubmission?.condition;
if (validateSubmission && evaluateCondition(valCond, submission)) {
  // ... validate ...
}
```

### Important: enrichment is not conditioned

The `forwardSubmission()` call does double duty — HTTP POST to the external URL **and** AI enrichment (transcribe, extract, analyzeAudio, extractText). The condition on `forwardUrl` gates **only the external HTTP POST**. Enrichment must run unconditionally because `fwdResult.enrichment` is consumed by the edit step and the email body regardless of whether the external URL receives anything.

Implementation: keep the `forwardSubmission()` call as-is; add a secondary check inside `forward.ts` (or in hook.ts after the call) that skips the actual HTTP POST to the external URL when the condition is not met, but still returns the enrichment result.

---

## Configure page UI

### Design principles (Notion-style)

- Top-level group has a combinator toggle: **All of** (AND) / **Any of** (OR).
- Each rule row: `[field dropdown/input] [operator dropdown] [value input]` + delete button.
- "+ Add rule" adds a sibling rule to the current group.
- "+ Add group" adds a nested sub-group with its own combinator toggle and rule rows.
- Sub-groups display indented with their own combinator toggle.
- "× Remove" on a group removes the whole group and its children.
- If the condition is empty (no rules), it is omitted from the saved config (treat as always-run).

### Where it appears

The condition builder lives inside each operation's section on the configure page:

```
[ Email Notification section ]
  To: ...
  Subject: ...
  ...
  ▼ Condition (optional — leave empty to always send)
    [ condition builder widget ]

[ Forwarding section ]
  URL: ...
  ▼ Condition (optional)
    [ condition builder widget ]
```

Each section manages its own condition state independently.

### Field input

Rather than a fixed dropdown (we don't know the submission schema ahead of time), the field input is a **free-text input** with a small hint: "Enter a field name or xpath (e.g. `group/question`)". This matches the existing pattern used for `toXPaths` and other field references.

### AI condition generator

Above the manual builder, each condition section has a collapsible **"Describe with AI"** panel:

```
▼ Condition (optional — leave empty to always send)
  ┌─ Describe with AI ────────────────────────────────────────────┐
  │  [expandable textarea — grows with content]                   │
  │  e.g. "Send only when status is approved and region is north" │
  │                                                               │
  │  [Generate]  [Clear]                                          │
  └───────────────────────────────────────────────────────────────┘
  [ condition builder widget — populated / editable after generate ]
```

**Flow:**
1. User types a natural-language description and clicks **Generate**.
2. The UI posts `{ prompt, currentCondition }` to `POST /api/configure/condition/generate`.
3. The Worker calls OpenAI with a system prompt that explains the `Condition` JSON schema and returns a populated `ConditionGroup`.
4. The response replaces the current builder state and re-renders the widget.
5. The user can then edit rules manually or type a follow-up prompt and click **Generate** again — `currentCondition` is sent each time so the AI can refine rather than start from scratch.

**Textarea behaviour:** auto-grows with content (CSS `field-sizing: content` with a min-height of ~3 lines and a max-height of ~12 lines before scrolling). The textarea persists its last value in the DOM so follow-up prompts are easy.

**Error handling:** if OpenAI returns unparseable JSON or the Worker key is missing, show an inline error below the textarea; leave the existing builder state untouched.

### New endpoint: `POST /api/configure/condition/generate`

Request body:
```ts
{ prompt: string; currentCondition?: Condition }
```

System prompt sent to `gpt-4o-mini`:
```
You are a filter-rule builder. The user describes a filter condition in plain language.
Return ONLY valid JSON matching this TypeScript type (no explanation, no markdown):

type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with"
              | "ends_with" | "is_empty" | "is_not_empty" | "greater_than" | "less_than"
              | "greater_than_or_equal" | "less_than_or_equal";
interface ConditionRule { type: "rule"; field: string; operator: Operator; value?: string; }
type Combinator = "and" | "or";
interface ConditionGroup { type: "group"; combinator: Combinator; rules: Array<ConditionRule | ConditionGroup>; }

Field names must be taken verbatim from the user's description.
If the user's prompt is a refinement, incorporate the currentCondition as a starting point.
```

Response: `{ condition: ConditionGroup }` or `{ error: string }` on failure.

The endpoint requires `OPENAI_API_KEY` to be set; returns `501` with `{ error: "AI not configured" }` if missing.

### Saving

When the user clicks "Save" for a section, the existing save logic is extended to include the serialised `condition` (or omit it if the builder is empty). The condition is built from the in-memory JS state of the builder widget and serialised to the JSON shape above.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/submissionValue.ts` | **New** — extracted `getPayloadValue()` |
| `src/lib/evaluateCondition.ts` | **New** — condition evaluator |
| `src/routes/hook.ts` | Import `evaluateCondition`, wrap each operation with condition check; import `getPayloadValue` from new util |
| `src/routes/configure.ts` | Extend `GET`/`POST /api/configure/project/:uid` for condition fields; add `POST /api/configure/condition/generate` |
| `src/routes/ui.ts` | Condition builder widget + AI generator panel JS/HTML added to configure page |
| `src/types.ts` | Export `Condition`, `ConditionRule`, `ConditionGroup`, `Operator`, `Combinator` types |

---

## Implementation phases

### Phase 1 — Core types & evaluator
1. Add `Condition`-related types to `src/types.ts`
2. Create `src/lib/submissionValue.ts` (extract from `hook.ts`)
3. Create `src/lib/evaluateCondition.ts`
4. Update `hook.ts` imports; replace inline `getPayloadValue` with import

### Phase 2 — Hook integration
5. Wrap `emailNotification` execution with `evaluateCondition`
6. Wrap `forwardUrl` execution with `evaluateCondition`
7. Wrap `validateSubmission` execution with `evaluateCondition`
8. Wrap `geocode` execution with `evaluateCondition`
9. (Pattern established — future operations follow same wrapping)

### Phase 3 — Persist condition in config
10. Extend the existing `POST /api/configure/project/:uid` body to accept the new condition fields: `forwardCondition`, `geocodeCondition`, and `condition` nested inside `emailNotification` and `validateSubmission`.
11. Extend the `GET /api/configure/project/:uid` response to pass those fields back so the UI can re-hydrate. No new endpoint is needed — the existing project GET/POST pair is the correct place.

### Phase 4 — Configure page UI
12. Build reusable `conditionBuilder(containerId, onChange)` JS function in `ui.ts`
13. Wire it into the email section
14. Wire it into the forwarding section
15. Wire it into the validate section
16. Serialize/deserialize condition state on save/load

### Phase 5 — AI condition generator
17. Add `POST /api/configure/condition/generate` in `configure.ts`
18. Add the collapsible "Describe with AI" panel to `conditionBuilder` (above the manual rules); textarea auto-grows
19. On Generate: POST prompt + currentCondition, replace builder state with returned `ConditionGroup`, re-render
20. On follow-up prompt: include current builder state as `currentCondition` so AI refines rather than restarts

---

## Testing strategy

`evaluateCondition` is pure and has no I/O, so it can be unit-tested with a simple test runner (or even manual smoke tests in a Node REPL) before any UI work starts. Write at least:
- Single rule, each operator
- Top-level AND / OR groups
- Nested group (AND inside OR, OR inside AND)
- Undefined condition (should return `true`)
- Empty group (should return `true`)

---

## Non-goals / future

- Persisted condition templates reusable across forms — out of scope for now
- Conditions on transcription / extraction / PDF steps — easy to add later using the same pattern, deliberately deferred
- A full visual query builder with field autocomplete (requires fetching the form schema from the Kobo API) — noted in `future.txt`
