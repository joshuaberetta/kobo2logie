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
 * Collects all string values from the flat submission JSON (excluding _attachments).
 * Used to identify which attachments are actually referenced in the submission data —
 * the REST service may filter out some questions, so only referenced images are forwarded.
 */
export function submissionImageFilenames(submission: KoboSubmission): Set<string> {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(submission)) {
    if (key === "_attachments") continue;
    if (typeof value === "string" && value.length > 0) {
      names.add(value);
    }
  }
  return names;
}

/**
 * Returns non-deleted attachments (all mimetypes) whose media_file_basename
 * appears as a string value in the reference payload.
 * When a fields subset is active, pass the filtered jsonPayload as reference
 * so only attachments relevant to those fields are fetched and forwarded.
 */
export function attachmentsToForward(
  submission: KoboSubmission,
  reference?: Record<string, unknown>
): KoboAttachment[] {
  const scanTarget = reference ?? submission;
  const filenames = new Set<string>();
  for (const [key, value] of Object.entries(scanTarget)) {
    if (key === "_attachments") continue;
    if (typeof value === "string" && value.length > 0) {
      filenames.add(value);
    }
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
