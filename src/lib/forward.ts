import { attachmentsToForward } from "./kobo.js";
import type { KoboSubmission } from "./kobo.js";
import { transcribeAudio } from "./transcribe.js";
import { describeImage } from "./describe.js";

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
 *   - "submission"              — full submission JSON string (with transcripts injected)
 *   - "<media_file_basename>"   — one binary File part per referenced, non-deleted image
 *
 * If transcribeConfig and openaiApiKey are provided, audio attachments for each
 * named question are fetched and transcribed; the results are injected into the
 * submission JSON as "<questionName>_transcript" before forwarding.
 *
 * If describeConfig and openaiApiKey are provided, image attachments for each
 * named question are fetched and described; the results are injected into the
 * submission JSON as "<questionName>_description" before forwarding.
 *
 * The correct wfp_logie Kobo token is selected based on koboBaseUrl hostname.
 * All errors are swallowed and logged — this function never throws.
 */
export async function forwardSubmission(
  submission: KoboSubmission,
  forwardUrl: string,
  koboBaseUrl: string,
  tokens: { global: string; eu: string },
  jsonPayload?: Record<string, unknown>,
  forwardToken?: string,
  transcribeConfig?: { questions: string[]; model?: string; prompt?: string },
  openaiApiKey?: string,
  describeConfig?: { questions: string[]; model?: string; prompt?: string },
  forwardMedia?: string[]
): Promise<void> {
  try {
    const token = resolveKoboToken(koboBaseUrl, tokens);

    // Build the working payload; we may mutate it with transcript keys below.
    const payload: Record<string, unknown> = jsonPayload ? { ...jsonPayload } : { ...submission };

    // ── Transcription ──────────────────────────────────────────────────────
    if (transcribeConfig && openaiApiKey && transcribeConfig.questions.length > 0) {
      // Build a lookup map: question_xpath → attachment
      const audioByXpath = new Map(
        (submission._attachments ?? [])
          .filter((a) => !a.is_deleted && a.mimetype.startsWith("audio/"))
          .map((a) => [a.question_xpath, a])
      );

      await Promise.all(
        transcribeConfig.questions.map(async (questionName) => {
          const att = audioByXpath.get(questionName);
          if (!att) {
            console.warn(`[transcribe] No audio attachment found for question_xpath "${questionName}"`);
            return;
          }
          try {
            const res = await fetch(att.download_url, {
              headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) {
              console.error(
                `[transcribe] Failed to fetch audio for "${questionName}": HTTP ${res.status}`
              );
              return;
            }
            const blob = await res.blob();
            const transcript = await transcribeAudio(
              blob,
              att.media_file_basename,
              openaiApiKey,
              transcribeConfig.model,
              transcribeConfig.prompt
            );
            if (transcript) {
              payload[`${questionName}_transcript`] = transcript;
            }
          } catch (err) {
            console.error(`[transcribe] Error transcribing "${questionName}":`, err);
          }
        })
      );
    }

    // ── Image description ──────────────────────────────────────────────────
    if (describeConfig && openaiApiKey && describeConfig.questions.length > 0) {
      const imageByXpath = new Map(
        (submission._attachments ?? [])
          .filter((a) => !a.is_deleted && a.mimetype.startsWith("image/"))
          .map((a) => [a.question_xpath, a])
      );

      await Promise.all(
        describeConfig.questions.map(async (questionName) => {
          const att = imageByXpath.get(questionName);
          if (!att) {
            console.warn(`[describe] No image attachment found for question_xpath "${questionName}"`);
            return;
          }
          try {
            const res = await fetch(att.download_url, {
              headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) {
              console.error(
                `[describe] Failed to fetch image for "${questionName}": HTTP ${res.status}`
              );
              return;
            }
            const blob = await res.blob();
            const description = await describeImage(
              blob,
              att.media_file_basename,
              openaiApiKey,
              describeConfig.model,
              describeConfig.prompt
            );
            if (description) {
              payload[`${questionName}_description`] = description;
            }
          } catch (err) {
            console.error(`[describe] Error describing "${questionName}":`, err);
          }
        })
      );
    }

    // ── Attachment fetch & forward ─────────────────────────────────────────
    let attachments = attachmentsToForward(submission, jsonPayload);

    // Filter by allowed media types if the user has restricted forwarding
    if (forwardMedia && forwardMedia.length > 0) {
      attachments = attachments.filter((a) =>
        forwardMedia.some((prefix) => a.mimetype.startsWith(prefix + "/"))
      );
    }

    const form = new FormData();
    form.append("submission", JSON.stringify(payload));

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

    const fwdHeaders: HeadersInit = {};
    if (forwardToken) fwdHeaders["Authorization"] = `Bearer ${forwardToken}`;

    const fwdRes = await fetch(forwardUrl, {
      method: "POST",
      headers: fwdHeaders,
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
