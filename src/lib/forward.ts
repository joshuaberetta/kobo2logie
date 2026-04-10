import { attachmentsToForward } from "./kobo.js";
import type { KoboSubmission } from "./kobo.js";

const EU_HOSTNAME = "eu.kobotoolbox.org";

function resolveKoboToken(
  koboBaseUrl: string,
  tokens: { global: string; eu: string }
): string {
  try {
    const host = new URL(koboBaseUrl).hostname;
    return host === EU_HOSTNAME ? tokens.eu : tokens.global;
  } catch {
    return tokens.global;
  }
}

/**
 * Fire-and-forget: fetches the images referenced in the submission and POSTs
 * everything to forwardUrl as multipart/form-data.
 *
 * Parts:
 *   - "submission"              — full submission JSON string
 *   - "<media_file_basename>"   — one binary File part per referenced, non-deleted image
 *
 * The correct wfp_logie Kobo token is selected based on koboBaseUrl hostname.
 * All errors are swallowed and logged — this function never throws.
 */
export async function forwardSubmission(
  submission: KoboSubmission,
  forwardUrl: string,
  koboBaseUrl: string,
  tokens: { global: string; eu: string },
  jsonPayload?: Record<string, unknown>
): Promise<void> {
  try {
    const attachments = attachmentsToForward(submission, jsonPayload);
    const token = resolveKoboToken(koboBaseUrl, tokens);

    const form = new FormData();
    form.append("submission", JSON.stringify(jsonPayload ?? submission));

    await Promise.all(
      attachments.map(async (att) => {
        try {
          const res = await fetch(att.download_url, {
            headers: { Authorization: `Token ${token}` },
          });
          if (!res.ok) {
            console.error(
              `[forward] Failed to fetch attachment ${att.media_file_basename}: HTTP ${res.status}`
            );
            return;
          }
          const blob = await res.blob();
          form.append(
            att.media_file_basename,
            new File([blob], att.media_file_basename, { type: att.mimetype })
          );
        } catch (err) {
          console.error(
            `[forward] Error fetching attachment ${att.media_file_basename}:`,
            err
          );
        }
      })
    );

    const fwdRes = await fetch(forwardUrl, {
      method: "POST",
      body: form,
    });

    if (!fwdRes.ok) {
      console.error(
        `[forward] External service returned HTTP ${fwdRes.status} for ${forwardUrl}`
      );
    }
  } catch (err) {
    console.error("[forward] Unhandled error in forwardSubmission:", err);
  }
}
