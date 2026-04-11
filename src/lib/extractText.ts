const DEFAULT_PROMPT =
  "Extract named entities (people, locations, organizations) and any other key facts from this text. Return a flat JSON object with string values only — no nested objects, no explanation, just valid JSON.";

/**
 * Sends a free-text string to the OpenAI Chat Completions API and asks it to
 * return a JSON object of extracted field values (named entities, key facts, etc.).
 *
 * Returns a flat Record<string, string> on success, or null on failure.
 * Keys from the AI response are used directly as xpath field names — the caller
 * must strip any reserved keys (e.g. _uuid) before write-back.
 * Never throws — safe to use inside a fire-and-forget pipeline.
 */
export async function extractTextFields(
  text: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
  prompt = DEFAULT_PROMPT
): Promise<Record<string, string> | null> {
  if (!text.trim()) return null;

  try {
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
              "You extract structured data from free-text answers. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.",
          },
          { role: "user", content: prompt + "\n\nText:\n" + text },
        ],
        max_tokens: 512,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      console.error(`[extract-text] OpenAI error: HTTP ${res.status} — ${errText}`);
      return null;
    }

    const data = await res.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return null;

    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("[extract-text] AI response was not a plain object");
      return null;
    }

    // Coerce all values to strings; drop null/undefined entries
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v != null) {
        result[k] = String(v);
      }
    }
    return result;
  } catch (err) {
    console.error("[extract-text] Unexpected error:", err);
    return null;
  }
}
