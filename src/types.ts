export interface LogEntry {
  ts: number;          // Unix ms timestamp
  uuid?: string;       // submission _uuid
  id?: number;         // submission _id
  ok: boolean;         // forward succeeded
  httpStatus?: number; // HTTP status code from the forwarding target
  responseBody?: string; // first 2 KB of the target's response body
  error?: string;      // error message if failed
}

export interface Env {
  FORM_SESSION: DurableObjectNamespace;
  FORWARD_CONFIG: KVNamespace;
  DEFAULT_KOBO_BASE_URL: string;
  MAX_BUFFER_SIZE: string;
  MAX_BODY_BYTES: string;
  KOBO_API_TOKEN_GLOBAL: string;
  KOBO_API_TOKEN_EU: string;
  OPENAI_API_KEY: string;
}
