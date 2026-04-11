const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB — OpenAI vision hard limit

const DEFAULT_PROMPT =
  "Extract structured data from this image. Return a flat JSON object with string values only — no nested objects, no explanation, just valid JSON.";

/**
 * Sends an image blob to the OpenAI Chat Completions API (vision) and asks it
 * to return a JSON object containing extracted field values.
 *
 * Returns a flat Record<string, string> on success, or null on failure.
 * Keys from the AI response are used directly as field names — the caller is
 * responsible for stripping any reserved keys (e.g. _uuid) before write-back.
 * Never throws — safe to use inside a fire-and-forget pipeline.
 */
export async function extractFields(
  imageBlob: Blob,
  filename: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
  prompt = DEFAULT_PROMPT
): Promise<Record<string, string> | null> {
  if (imageBlob.size > MAX_IMAGE_BYTES) {
    console.warn(
      `[extract] Skipping ${filename}: size ${imageBlob.size} exceeds 20 MB limit`
    );
    return null;
  }

  try {
    const arrayBuffer = await imageBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mimeType = imageBlob.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You extract structured data from images. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
            ],
          },
        ],
        max_tokens: 512,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      console.error(
        `[extract] OpenAI error for ${filename}: HTTP ${res.status} — ${errText}`
      );
      return null;
    }

    const data = await res.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return null;

    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(`[extract] AI response for ${filename} was not a plain object`);
      return null;
    }

    // Coerce all values to strings; skip nulls
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v != null) result[k] = String(v);
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.error(`[extract] Unexpected error extracting from ${filename}:`, err);
    return null;
  }
}
