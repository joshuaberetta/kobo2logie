const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — OpenAI Whisper hard limit

/**
 * Transcribes an audio blob using the OpenAI audio transcriptions API.
 * Returns the transcript text, or "" if the file is too large or any error occurs.
 * Never throws — safe to use inside a fire-and-forget pipeline.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  filename: string,
  openaiApiKey: string,
  model = "gpt-4o-mini-transcribe"
): Promise<string> {
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    console.warn(
      `[transcribe] Skipping ${filename}: size ${audioBlob.size} exceeds 25 MB limit`
    );
    return "";
  }

  try {
    const form = new FormData();
    form.append("file", new File([audioBlob], filename, { type: audioBlob.type }));
    form.append("model", model);
    form.append("response_format", "text");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiApiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      console.error(
        `[transcribe] OpenAI error for ${filename}: HTTP ${res.status} — ${errText}`
      );
      return "";
    }

    return (await res.text()).trim();
  } catch (err) {
    console.error(`[transcribe] Unexpected error transcribing ${filename}:`, err);
    return "";
  }
}
