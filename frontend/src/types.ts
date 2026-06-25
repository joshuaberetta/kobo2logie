export interface SurveyQuestion {
  xpath: string
  label: string
  type: string
}

// ── Condition engine ─────────────────────────────────────────────────────────

export type Operator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'

export type Combinator = 'and' | 'or'

export interface ConditionRule {
  type: 'rule'
  field: string
  operator: Operator
  value?: string
}

export interface ConditionGroup {
  type: 'group'
  combinator: Combinator
  rules: Array<ConditionRule | ConditionGroup>
}

// ── Config shapes ────────────────────────────────────────────────────────────

export interface EnrichFieldDef {
  key: string
  instruction: string
}

export interface EnrichPrompt {
  description?: string
  fields: EnrichFieldDef[]
}

export interface EnrichConfig {
  questions: string[]
  model?: string
  prompt?: string
  translateTo?: string
  prompts?: Record<string, EnrichPrompt>
}

export interface AppendValue {
  key: string
  value: string
}

export interface AiBodyConfig {
  instructions: string
}

export interface PdfReportConfig {
  template?: string
  formTitle?: string
}

export interface EmailNotificationConfig {
  to: string[]
  toXPaths?: string[]
  subject: string
  body?: string
  cc?: string[]
  ccXPaths?: string[]
  bcc?: string[]
  bccXPaths?: string[]
  aiBody?: AiBodyConfig
  attachments?: string[]
  pdfReport?: PdfReportConfig
  condition?: ConditionGroup
}

export interface ValidationOptions {
  approved?: string
  notApproved?: string
  onHold?: string
}

export interface ValidateSubmissionConfig {
  instructions: string
  includeReasoning?: boolean
  options?: ValidationOptions
  condition?: ConditionGroup
}

export interface FailureNotificationConfig {
  to: string[]
  subject: string
  body?: string
  cc?: string[]
  bcc?: string[]
}

export interface ProjectConfig {
  server: string
  forwardUrl: string
  forwardToken: string
  forwardToLogie: boolean
  fields: string[]
  transcribe?: EnrichConfig | null
  extract?: EnrichConfig | null
  analyzeAudio?: EnrichConfig | null
  extractText?: EnrichConfig | null
  forwardMedia?: string[] | null
  appendValues: AppendValue[]
  editOriginal: boolean
  geocode: boolean
  geocodeField?: string
  geocodeAddressFields?: string[]
  emailNotification?: EmailNotificationConfig | null
  validateSubmission?: ValidateSubmissionConfig | null
  failureNotification?: FailureNotificationConfig | null
  forwardCondition?: ConditionGroup | null
  geocodeCondition?: ConditionGroup | null
}

// ── Log entry ────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number
  ts: number
  uuid: string
  submission_id: number | null
  ok: boolean
  httpStatus?: number
  responseBody?: string
  error?: string
  editOk?: boolean
  editHttpStatus?: number
  editError?: string
  validateOk?: boolean
  validateHttpStatus?: number
  validateError?: string
  geocodeOk?: boolean
  geocodeError?: string
  geocodeAddressSteps?: Record<string, unknown>
  transcribeSteps?: unknown
  analyzeAudioSteps?: unknown
  extractSteps?: unknown
  extractTextSteps?: unknown
  emailOk?: boolean
  emailError?: string
  failureEmailOk?: boolean
  failureEmailError?: string
  [key: string]: unknown
}

export interface LogsResponse {
  total: number
  page: number
  page_size: number
  results: LogEntry[]
}
