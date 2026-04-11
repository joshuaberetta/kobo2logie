const DEFAULT_PROMPT =
  "Analyze this transcript. Return a flat JSON object with string values only — no nested objects, no explanation, just valid JSON.";

/**
 * Sends a transcript string to the OpenAI Chat Completions API and asks it to
 * return a JSON object of extracted/derived field values (summary, themes,
 * sentiment, etc.).
 *
 * Returns a flat Record<string, string> on success, or null on failure.
 * Keys from the AI response are used directly as xpath field names — the caller
 * must strip any reserved keys (e.g. _uuid) before write-back.
 * Never throws — safe to use inside a fire-and-forget pipeline.
 */
export async function analyzeAudioText(
  transcript: string,
  openaiApiKey: string,
  model = "gpt-4o-mini",
  prompt = DEFAULT_PROMPT
): Promise<Record<string, string> | null> {
  if (!transcript.trim()) return null;

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
              "You analyze transcripts and extract structured data. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.",
          },
          { role: "user", content: prompt + "\n\nTranscript:\n" + transcript },
        ],
        max_tokens: 512,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      console.error(`[analyze-audio] OpenAI error: HTTP ${res.status} — ${errText}`);
      return null;
    }

    const data = await res.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return null;

    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("[analyze-audio] AI response was not a plain object");
      return null;
    }

    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v != null) result[k] = String(v);
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.error("[analyze-audio] Unexpected error:", err);
    return null;
  }
}
