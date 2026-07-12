import { attachmentsToForward } from "./kobo.js";
import type { KoboSubmission } from "./kobo.js";
import { transcribeAudio } from "./transcribe.js";
import { extractFields } from "./extract.js";
import { analyzeAudioText } from "./analyzeAudio.js";
import { extractTextFields } from "./extractText.js";
import { geocodeAddress } from "./geocode.js";
import type { EnrichmentStepResult } from "../types.js";

const EU_HOSTNAME = "eu.kobotoolbox.org";

type PromptField = { key: string; instruction: string; geocode?: boolean };
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

/**
 * For each extracted field flagged `geocode: true` in the prompt config, forward-
 * geocode its string value via `geocodeAddress()` and write the resulting
 * `_latitude` / `_longitude` / `_adm{n}_*` fields into both `payload` and
 * `enrichment`, prefixed with the extracted field's key
 * (e.g. `address` → `address_adm1_name`).
 *
 * Returns the list of keys written, so the caller can append them to the step's
 * `keys` array for logging. Never throws — `geocodeAddress()` swallows its errors.
 */
async function geocodeExtractedFields(
  prompts: PromptMap | undefined,
  questionName: string,
  extracted: Record<string, string>,
  payload: Record<string, unknown>,
  enrichment: Record<string, string>
): Promise<string[]> {
  const geocodeKeys = (prompts?.[questionName]?.fields ?? [])
    .filter((f) => f.geocode && f.key.trim())
    .map((f) => f.key.trim());
  if (geocodeKeys.length === 0) return [];

  const written: string[] = [];
  await Promise.all(
    geocodeKeys.map(async (key) => {
      const value = extracted[key];
      if (typeof value !== "string" || !value.trim()) return;
      try {
        const geo = await geocodeAddress(value.trim());
        for (const [k, v] of Object.entries(geo)) {
          const prefixedKey = `${key}${k}`;
          payload[prefixedKey] = v;
          enrichment[prefixedKey] = v;
          written.push(prefixedKey);
        }
      } catch (err) {
        console.error(`[geocode-extracted] Error geocoding "${key}" for "${questionName}":`, err);
      }
    })
  );
  return written;
}

export interface ForwardResult {
  ok: boolean;
  httpStatus?: number;
  responseBody?: string;
  error?: string;
  /** Keys written into the payload during enrichment (transcripts + descriptions). Used by the edit-back step. */
  enrichment?: Record<string, string>;
  steps?: {
    transcribe?: Record<string, EnrichmentStepResult>;
    analyzeAudio?: Record<string, EnrichmentStepResult>;
    extract?: Record<string, EnrichmentStepResult>;
    extractText?: Record<string, EnrichmentStepResult>;
  };
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
  extractTextConfig?: { questions: string[]; model?: string; prompts?: PromptMap },
  logieApiKey?: string
): Promise<ForwardResult> {
  try {
    const token = resolveKoboToken(koboBaseUrl, tokens);

    // Tracks enrichment values added to the payload — returned so the caller
    // can optionally write them back to Kobo via the edit-back step.
    const enrichment: Record<string, string> = {};
    const steps: NonNullable<ForwardResult["steps"]> = {};

    // Build the working payload; we may mutate it with transcript keys below.
    const payload: Record<string, unknown> = jsonPayload ? { ...jsonPayload } : { ...submission };

    // ── Transcription ──────────────────────────────────────────────────────
    if (transcribeConfig && openaiApiKey && transcribeConfig.questions.length > 0) {
      steps.transcribe = {};
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
            steps.transcribe![questionName] = { ok: false, error: "No audio attachment found" };
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
              steps.transcribe![questionName] = { ok: false, error: `Failed to fetch audio: HTTP ${res.status}` };
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
              const transcriptKey = `${questionName}_transcript`;
              payload[transcriptKey] = finalText;
              enrichment[transcriptKey] = finalText;
              steps.transcribe![questionName] = { ok: true, keys: [transcriptKey] };
            } else {
              steps.transcribe![questionName] = { ok: false, error: "No transcript returned" };
            }
          } catch (err) {
            console.error(`[transcribe] Error transcribing "${questionName}":`, err);
            steps.transcribe![questionName] = { ok: false, error: String(err) };
          }
        })
      );
    }
    // ── Audio analysis ─────────────────────────────────────────────────────
    if (analyzeAudioConfig && openaiApiKey && analyzeAudioConfig.questions.length > 0) {
      steps.analyzeAudio = {};
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
                steps.analyzeAudio![questionName] = { ok: false, error: "No audio attachment found" };
                return;
              }
              const res = await fetch(att.download_url, {
                headers: { Authorization: `Token ${token}` },
              });
              if (!res.ok) {
                console.error(`[analyze-audio] Failed to fetch audio for "${questionName}": HTTP ${res.status}`);
                steps.analyzeAudio![questionName] = { ok: false, error: `Failed to fetch audio: HTTP ${res.status}` };
                return;
              }
              const blob = await res.blob();
              transcript = await transcribeAudio(blob, att.media_file_basename, openaiApiKey) || undefined;
            }

            if (!transcript) {
              steps.analyzeAudio![questionName] = { ok: false, error: "No transcript available for analysis" };
              return;
            }

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
              const writtenKeys: string[] = [];
              for (const [k, v] of Object.entries(analyzed)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                  writtenKeys.push(k);
                }
              }
              const geoKeys = await geocodeExtractedFields(
                analyzeAudioConfig.prompts, questionName, analyzed, payload, enrichment
              );
              steps.analyzeAudio![questionName] = { ok: true, keys: [...writtenKeys, ...geoKeys] };
            } else {
              steps.analyzeAudio![questionName] = { ok: false, error: "No analysis returned" };
            }
          } catch (err) {
            console.error(`[analyze-audio] Error analyzing "${questionName}":`, err);
            steps.analyzeAudio![questionName] = { ok: false, error: String(err) };
          }
        })
      );
    }
    // ── Field extraction ───────────────────────────────────────────────────
    if (extractConfig && openaiApiKey && extractConfig.questions.length > 0) {
      steps.extract = {};
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
            steps.extract![questionName] = { ok: false, error: "No image attachment found" };
            return;
          }
          try {
            const res = await fetch(att.download_url, {
              headers: { Authorization: `Token ${token}` },
            });
            if (!res.ok) {
              console.error(`[extract] Failed to fetch image for "${questionName}": HTTP ${res.status}`);
              steps.extract![questionName] = { ok: false, error: `Failed to fetch image: HTTP ${res.status}` };
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
              const writtenKeys: string[] = [];
              for (const [k, v] of Object.entries(extracted)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                  writtenKeys.push(k);
                }
              }
              const geoKeys = await geocodeExtractedFields(
                extractConfig.prompts, questionName, extracted, payload, enrichment
              );
              steps.extract![questionName] = { ok: true, keys: [...writtenKeys, ...geoKeys] };
            } else {
              steps.extract![questionName] = { ok: false, error: "No fields extracted" };
            }
          } catch (err) {
            console.error(`[extract] Error extracting from "${questionName}":`, err);
            steps.extract![questionName] = { ok: false, error: String(err) };
          }
        })
      );
    }

    // ── Text field extraction ─────────────────────────────────────────────
    if (extractTextConfig && openaiApiKey && extractTextConfig.questions.length > 0) {
      steps.extractText = {};
      await Promise.all(
        extractTextConfig.questions.map(async (questionName) => {
          try {
            const text = (submission as Record<string, unknown>)[questionName];
            if (typeof text !== "string" || !text.trim()) {
              steps.extractText![questionName] = { ok: false, error: "No text value found for question" };
              return;
            }
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
              const writtenKeys: string[] = [];
              for (const [k, v] of Object.entries(extracted)) {
                if (k !== "_uuid") {
                  payload[k] = v;
                  enrichment[k] = v;
                  writtenKeys.push(k);
                }
              }
              const geoKeys = await geocodeExtractedFields(
                extractTextConfig.prompts, questionName, extracted, payload, enrichment
              );
              steps.extractText![questionName] = { ok: true, keys: [...writtenKeys, ...geoKeys] };
            } else {
              steps.extractText![questionName] = { ok: false, error: "No fields extracted" };
            }
          } catch (err) {
            console.error(`[extract-text] Error extracting from "${questionName}":`, err);
            steps.extractText![questionName] = { ok: false, error: String(err) };
          }
        })
      );
    }

    // If there is no forwarding target, return enrichment and stop here.
    if (!forwardUrl) {
      return { ok: true, enrichment, steps: Object.keys(steps).length > 0 ? steps : undefined };
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
    if (logieApiKey) {
      fwdHeaders["x-api-key"] = logieApiKey;
    } else if (forwardToken) {
      fwdHeaders["Authorization"] = `Bearer ${forwardToken}`;
    }

    const fwdRes = await fetch(forwardUrl, {
      method: "POST",
      headers: fwdHeaders,
      body: form,
    });

    const responseBody = await fwdRes.text().catch(() => undefined);
    const truncatedBody = responseBody ? responseBody.slice(0, 2048) : undefined;
    const stepsResult = Object.keys(steps).length > 0 ? steps : undefined;
    if (!fwdRes.ok) {
      console.error(
        `[forward] External service returned HTTP ${fwdRes.status} for ${forwardUrl}`
      );
      return { ok: false, httpStatus: fwdRes.status, responseBody: truncatedBody, enrichment, steps: stepsResult };
    }
    return { ok: true, httpStatus: fwdRes.status, responseBody: truncatedBody, enrichment, steps: stepsResult };
  } catch (err) {
    console.error("[forward] Unhandled error in forwardSubmission:", err);
    return { ok: false, error: String(err) };
  }
}
