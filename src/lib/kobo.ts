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
 */
export function fileAttachments(submission: KoboSubmission): KoboAttachment[] {
  return (submission._attachments ?? []).filter(
    (a) => !a.is_deleted && !a.mimetype.startsWith("image/")
  );
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
