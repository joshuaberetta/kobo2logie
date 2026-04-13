export type ValidationDecision = "approved" | "not_approved" | "on_hold";

export interface ValidationResult {
  decision: ValidationDecision;
  reasoning: string;
}

/**
 * Calls the OpenAI API to determine the validation status of a Kobo submission.
 * Returns the AI's decision and reasoning, or null on failure.
 */
export async function callValidationAI(
  apiKey: string,
  submission: Record<string, unknown>,
  instructions: string,
  options: { approved: string; notApproved: string; onHold: string }
): Promise<ValidationResult | null> {
  const systemPrompt = [
    "You are a submission reviewer. Review the following form submission and decide on its validation status.",
    "",
    instructions ? `Overall context: ${instructions}` : "",
    "",
    "Criteria for each status:",
    `- Approved: ${options.approved || "The submission meets all requirements."}`,
    `- Not Approved: ${options.notApproved || "The submission does not meet requirements."}`,
    `- On Hold: ${options.onHold || "The submission needs further review."}`,
    "",
    'Respond with valid JSON only — no markdown fences, no extra text:',
    '{"decision":"approved"|"not_approved"|"on_hold","reasoning":"<explanation>"}',
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Submission data:\n${JSON.stringify(submission, null, 2)}`,
          },
        ],
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      console.error(`[validate] OpenAI error ${res.status}`);
      return null;
    }

    const data = await res.json<{ choices: Array<{ message: { content: string } }> }>();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown code fences if the model returns them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error(`[validate] Failed to parse AI response: ${raw.slice(0, 200)}`);
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !["approved", "not_approved", "on_hold"].includes((parsed as Record<string, unknown>).decision as string)
    ) {
      console.error(`[validate] Unexpected AI response shape: ${cleaned.slice(0, 200)}`);
      return null;
    }

    const result = parsed as { decision: string; reasoning: string };
    return {
      decision: result.decision as ValidationDecision,
      reasoning: typeof result.reasoning === "string" ? result.reasoning : "",
    };
  } catch (err) {
    console.error("[validate] callValidationAI error:", err);
    return null;
  }
}
