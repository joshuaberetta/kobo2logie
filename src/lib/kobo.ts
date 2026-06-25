export interface KoboAttachment {
  uid: string;
  mimetype: string;
  filename: string;
  media_file_basename: string;
  question_xpath: string;
  is_deleted: boolean;
  download_url: string;
  download_large_url: string;
  download_medium_url: string;
  download_small_url: string;
}

export interface KoboSubmission {
  _id: number;
  _uuid: string;
  _xform_id_string: string;
  _submission_time: string;
  _submitted_by: string | null;
  _attachments: KoboAttachment[];
  [key: string]: unknown;
}

/**
 * Returns true if the given URL's hostname matches the hostname of baseUrl.
 * Used to prevent SSRF on the media proxy.
 */
export function isAllowedMediaHost(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(baseUrl);
    return target.hostname === base.hostname;
  } catch {
    return false;
  }
}

/**
 * Returns only non-deleted image attachments from a submission.
 */
export function imageAttachments(submission: KoboSubmission): KoboAttachment[] {
  return (submission._attachments ?? []).filter(
    (a) => !a.is_deleted && a.mimetype.startsWith("image/")
  );
}

/**
 * Returns only non-deleted non-image attachments (files, audio, video, etc.)
 * that are referenced (i.e. their basename appears as a string value) in the
 * given reference object (defaults to the full submission if omitted).
 */
export function nonImageAttachments(
  submission: KoboSubmission,
  reference?: Record<string, unknown>
): KoboAttachment[] {
  const filenames = submissionImageFilenames(
    reference !== undefined ? { ...submission, ...reference, _attachments: submission._attachments } : submission
  );
  return (submission._attachments ?? []).filter(
    (a) => !a.is_deleted && !a.mimetype.startsWith("image/") && filenames.has(a.media_file_basename)
  );
}

/**
 * Returns only non-deleted non-image attachments (files, audio, video, etc.)
 */
export function fileAttachments(submission: KoboSubmission): KoboAttachment[] {
  return (submission._attachments ?? []).filter(
    (a) => !a.is_deleted && !a.mimetype.startsWith("image/")
  );
}

/**
 * Recursively collects all string values from a value tree (objects, arrays, primitives).
 * Skips the _attachments key to avoid scanning attachment metadata as filenames.
 */
function collectStringValues(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    if (value.length > 0) names.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, names);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "_attachments") continue;
      collectStringValues(v, names);
    }
  }
}

/**
 * Collects all string values from the submission JSON (excluding _attachments),
 * including values nested inside repeat group arrays.
 * Used to identify which attachments are actually referenced in the submission data —
 * the REST service may filter out some questions, so only referenced images are forwarded.
 */
export function submissionImageFilenames(submission: KoboSubmission): Set<string> {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(submission)) {
    if (key === "_attachments") continue;
    collectStringValues(value, names);
  }
  return names;
}

/**
 * Returns non-deleted attachments (all mimetypes) whose media_file_basename
 * appears as a string value in the reference payload.
 * When a fields subset is active, pass the filtered jsonPayload as reference
 * so only attachments relevant to those fields are fetched and forwarded.
 * Handles repeat group arrays by scanning recursively.
 */
export function attachmentsToForward(
  submission: KoboSubmission,
  reference?: Record<string, unknown>
): KoboAttachment[] {
  const scanTarget = reference ?? submission;
  const filenames = new Set<string>();
  for (const [key, value] of Object.entries(scanTarget)) {
    if (key === "_attachments") continue;
    collectStringValues(value, filenames);
  }
  return (submission._attachments ?? []).filter(
    (a) => !a.is_deleted && filenames.has(a.media_file_basename)
  );
}

/** @deprecated Use attachmentsToForward instead */
export function imageAttachmentsToForward(submission: KoboSubmission): KoboAttachment[] {
  return attachmentsToForward(submission);
}

/**
 * Format a Kobo submission time string for display.
 */
export function formatSubmissionTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
