const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB — OpenAI vision hard limit

const DEFAULT_PROMPT =
  "Describe this image concisely and factually. Focus on what is visible.";

/**
 * Sends an image blob to the OpenAI Chat Completions API (vision) and returns
 * a plain-text description.
 * Returns "" if the image is too large, the API returns an error, or any other
 * error occurs. Never throws — safe to use inside a fire-and-forget pipeline.
 */
export async function describeImage(
  imageBlob: Blob,
  filename: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
  prompt = DEFAULT_PROMPT
): Promise<string> {
  if (imageBlob.size > MAX_IMAGE_BYTES) {
    console.warn(
      `[describe] Skipping ${filename}: size ${imageBlob.size} exceeds 20 MB limit`
    );
    return "";
  }

  try {
    // Encode the image as a base64 data URL
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
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
            ],
          },
        ],
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      console.error(
        `[describe] OpenAI error for ${filename}: HTTP ${res.status} — ${errText}`
      );
      return "";
    }

    const data = await res.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error(`[describe] Unexpected error describing ${filename}:`, err);
    return "";
  }
}
