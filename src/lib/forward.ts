import { attachmentsToForward } from "./kobo.js";
import type { KoboSubmission } from "./kobo.js";
import { transcribeAudio } from "./transcribe.js";
import { extractFields } from "./extract.js";
import { analyzeAudioText } from "./analyzeAudio.js";
import { extractTextFields } from "./extractText.js";

const EU_HOSTNAME = "eu.kobotoolbox.org";

type PromptField = { key: string; instruction: string };
type PromptEntry = { description?: string; fields: PromptField[] };
type PromptMap = Record<string, PromptEntry>;

/**
 * Converts structured output-field definitions into a plain-text prompt for the LLM.
 * Prepends an optional global description/context before the field list.
 */
function buildPromptFromFields(stored: PromptEntry): string {
  const parts: string[] = [];
  if (stored.description?.trim()) parts.push(stored.description.trim());
  const lines = stored.fields
    .filter((f) => f.key.trim())
    .map((f) => (f.instruction.trim() ? `- ${f.key}: ${f.instruction}` : `- ${f.key}`));
  if (lines.length > 0) {
    parts.push(
      "Extract the following fields and return them as a JSON object with exactly these keys:\n" +
      lines.join("\n")
    );
  }
  return parts.join("\n\n");
}

export interface ForwardResult {
  ok: boolean;
  httpStatus?: number;
  responseBody?: string;
  error?: string;
  /** Keys written into the payload during enrichment (transcripts + descriptions). Used by the edit-back step. */
  enrichment?: Record<string, string>;
}

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
 * The correct wfp_logie Kobo token is selected based on koboBaseUrl hostname.
 * All errors are swallowed and logged — this function never throws.
 */
export async function forwardSubmission(
  submission: KoboSubmission,
  forwardUrl: string | undefined,
  koboBaseUrl: string,
  tokens: { global: string; eu: string },
  jsonPayload?: Record<string, unknown>,
  forwardToken?: string,
  transcribeConfig?: { questions: string[]; model?: string; prompt?: string; translateTo?: string },
  openaiApiKey?: string,
  forwardMedia?: string[],
  extractConfig?: { questions: string[]; model?: string; prompts?: PromptMap },
  analyzeAudioConfig?: { questions: string[]; model?: string; prompts?: PromptMap },
  extractTextConfig?: { questions: string[]; model?: string; prompts?: PromptMap }
): Promise<ForwardResult> {
  try {
    const token = resolveKoboToken(koboBaseUrl, tokens);

    // Tracks enrichment values added to the payload — returned so the caller
    // can optionally write them back to Kobo via the edit-back step.
    const enrichment: Record<string, string> = {};

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
              // Optionally translate the transcript into a target language
              let finalText = transcript;
              if (transcribeConfig.translateTo) {
                try {
                  const tlRes = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${openaiApiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      model: "gpt-4o-mini",
                      messages: [
                        {
                          role: "system",
                          content: `Translate the following text to ${transcribeConfig.translateTo}. Return only the translated text, no explanation.`,
                        },
                        { role: "user", content: transcript },
                      ],
                      max_tokens: 1024,
                    }),
                  });
                  if (tlRes.ok) {
                    const tlData = await tlRes.json<{ choices?: Array<{ message?: { content?: string } }> }>();
                    finalText = tlData.choices?.[0]?.message?.content?.trim() ?? transcript;
                  } else {
                    console.error(`[transcribe] Translation failed for "${questionName}": HTTP ${tlRes.status}`);
                  }
                } catch (err) {
                  console.error(`[transcribe] Translation error for "${questionName}":`, err);
                }
              }
              payload[`${questionName}_transcript`] = finalText;
              enrichment[`${questionName}_transcript`] = finalText;
            }
          } catch (err) {
            console.error(`[transcribe] Error transcribing "${questionName}":`, err);
          }
        })
      );
    }
    // ── Audio analysis ─────────────────────────────────────────────────────
    if (analyzeAudioConfig && openaiApiKey && analyzeAudioConfig.questions.length > 0) {
      const audioByXpathForAnalysis = new Map(
        (submission._attachments ?? [])
          .filter((a) => !a.is_deleted && a.mimetype.startsWith("audio/"))
          .map((a) => [a.question_xpath, a])
      );

      await Promise.all(
        analyzeAudioConfig.questions.map(async (questionName) => {
          try {
            // Reuse transcript already placed in payload by the transcription step
            let transcript = payload[`${questionName}_transcript`] as string | undefined;

            if (!transcript) {
              // Transcription not enabled for this question — transcribe fresh for analysis only
              const att = audioByXpathForAnalysis.get(questionName);
              if (!att) {
                console.warn(`[analyze-audio] No audio attachment found for question_xpath "${questionName}"`);
                return;
              }
              const res = await fetch(att.download_url, {
                headers: { Authorization: `Token ${token}` },
              });
              if (!res.ok) {
                console.error(`[analyze-audio] Failed to fetch audio for "${questionName}": HTTP ${res.status}`);
                return;
              }
              const blob = await res.blob();
              transcript = await transcribeAudio(blob, att.media_file_basename, openaiApiKey) || undefined;
            }

            if (!transcript) return;

            const analyzeAudioFields = analyzeAudioConfig.prompts?.[questionName];
            const analyzed = await analyzeAudioText(
              transcript,
              openaiApiKey,
              analyzeAudioConfig.model,
              analyzeAudioFields && (analyzeAudioFields.description || analyzeAudioFields.fields?.length > 0)
                ? buildPromptFromFields(analyzeAudioFields)
                : undefined
            );
            if (analyzed) {
              for (const [k, v] of Object.entries(analyzed)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                }
              }
            }
          } catch (err) {
            console.error(`[analyze-audio] Error analyzing "${questionName}":`, err);
          }
        })
      );
    }
    // ── Field extraction ───────────────────────────────────────────────────
    if (extractConfig && openaiApiKey && extractConfig.questions.length > 0) {
      const imageByXpath = new Map(
        (submission._attachments ?? [])
          .filter((a) => !a.is_deleted && a.mimetype.startsWith("image/"))
          .map((a) => [a.question_xpath, a])
      );

      await Promise.all(
        extractConfig.questions.map(async (questionName) => {
          const att = imageByXpath.get(questionName);
          if (!att) {
            console.warn(`[extract] No image attachment found for question_xpath "${questionName}"`);
            return;
          }
          try {
            const res = await fetch(att.download_url, {
              headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) {
              console.error(`[extract] Failed to fetch image for "${questionName}": HTTP ${res.status}`);
              return;
            }
            const blob = await res.blob();
            const extractFields_ = extractConfig.prompts?.[questionName];
            const extracted = await extractFields(
              blob,
              att.media_file_basename,
              openaiApiKey,
              extractConfig.model,
              extractFields_ && (extractFields_.description || extractFields_.fields?.length > 0)
                ? buildPromptFromFields(extractFields_)
                : undefined
            );
            if (extracted) {
              for (const [k, v] of Object.entries(extracted)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                }
              }
            }
          } catch (err) {
            console.error(`[extract] Error extracting from "${questionName}":`, err);
          }
        })
      );
    }

    // ── Text field extraction ─────────────────────────────────────────────
    if (extractTextConfig && openaiApiKey && extractTextConfig.questions.length > 0) {
      await Promise.all(
        extractTextConfig.questions.map(async (questionName) => {
          try {
            const text = (submission as Record<string, unknown>)[questionName];
            if (typeof text !== "string" || !text.trim()) return;
            const extractTextFields_ = extractTextConfig.prompts?.[questionName];
            const extracted = await extractTextFields(
              text,
              openaiApiKey,
              extractTextConfig.model,
              extractTextFields_ && (extractTextFields_.description || extractTextFields_.fields?.length > 0)
                ? buildPromptFromFields(extractTextFields_)
                : undefined
            );
            if (extracted) {
              for (const [k, v] of Object.entries(extracted)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                }
              }
            }
          } catch (err) {
            console.error(`[extract-text] Error extracting from "${questionName}":`, err);
          }
        })
      );
    }

    // If there is no forwarding target, return enrichment and stop here.
    if (!forwardUrl) {
      return { ok: true, enrichment };
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

    const responseBody = await fwdRes.text().catch(() => undefined);
    const truncatedBody = responseBody ? responseBody.slice(0, 2048) : undefined;
    if (!fwdRes.ok) {
      console.error(
        `[forward] External service returned HTTP ${fwdRes.status} for ${forwardUrl}`
      );
      return { ok: false, httpStatus: fwdRes.status, responseBody: truncatedBody, enrichment };
    }
    return { ok: true, httpStatus: fwdRes.status, responseBody: truncatedBody, enrichment };
  } catch (err) {
    console.error("[forward] Unhandled error in forwardSubmission:", err);
    return { ok: false, error: String(err) };
  }
}
