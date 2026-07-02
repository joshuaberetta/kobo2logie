// ── Condition logic types ─────────────────────────────────────────────────────

export type Operator =
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

export interface ConditionRule {
  type: "rule";
  field: string;
  operator: Operator;
  value?: string;
}

export type Combinator = "and" | "or";

export interface ConditionGroup {
  type: "group";
  combinator: Combinator;
  rules: Array<ConditionRule | ConditionGroup>;
}

export type Condition = ConditionGroup;

// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichmentStepResult {
  ok: boolean;
  error?: string;
  keys?: string[]; // enrichment keys written (e.g. ["obs/observation_transcript"])
}

export interface LogEntry {
  ts: number;          // Unix ms timestamp
  uuid?: string;       // submission _uuid
  id?: number;         // submission _id
  ok: boolean;         // forward succeeded
  httpStatus?: number; // HTTP status code from the forwarding target
  responseBody?: string; // first 2 KB of the target's response body
  error?: string;      // error message if failed
  editOk?: boolean;        // true = edit-back succeeded, false = failed, absent = not attempted
  editHttpStatus?: number; // HTTP status from the Kobo bulk-edit endpoint
  editError?: string;      // error message if edit-back failed
  validateOk?: boolean;        // true = validation status set, false = failed, absent = not attempted
  validateHttpStatus?: number; // HTTP status from the Kobo validation_status endpoint
  validateError?: string;      // error message if validation failed
  pdfOk?: boolean;             // true = PDF generated and emailed, false = failed, absent = not attempted
  pdfError?: string;           // error message if PDF step failed
  // Enrichment steps (absent = step not configured / not attempted)
  transcribeSteps?: Record<string, EnrichmentStepResult>;
  analyzeAudioSteps?: Record<string, EnrichmentStepResult>;
  extractSteps?: Record<string, EnrichmentStepResult>;
  extractTextSteps?: Record<string, EnrichmentStepResult>;
  // Geocoding (geopoint field → reverse geocode)
  geocodeOk?: boolean;
  geocodeError?: string;
  // Address geocoding (text fields → forward geocode)
  geocodeAddressSteps?: Record<string, EnrichmentStepResult>;
  // Email notification
  emailOk?: boolean;
  emailError?: string;
  // Failure notification
  failureEmailOk?: boolean;
  failureEmailError?: string;
}

export interface FailureNotification {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

export interface Env {
  FORM_SESSION: DurableObjectNamespace;
  FORWARD_CONFIG: KVNamespace;
  SELF: Fetcher; // service binding to this worker (in-process hook re-invocation)
  DEFAULT_KOBO_BASE_URL: string;
  MAX_BUFFER_SIZE: string;
  MAX_BODY_BYTES: string;
  KOBO_API_TOKEN_GLOBAL: string;
  KOBO_API_TOKEN_EU: string;
  OPENAI_API_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  LOGIE_API_URL?: string;
  LOGIE_API_KEY?: string;
}
