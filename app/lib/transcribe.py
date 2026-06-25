"""
OpenAI Whisper audio transcription.
Port of src/lib/transcribe.ts.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB — OpenAI Whisper hard limit


def transcribe_audio(
    audio_bytes: bytes,
    filename: str,
    openai_api_key: str,
    model: str = 'gpt-4o-mini-transcribe',
    prompt: str | None = None,
) -> str:
    """
    Transcribes audio bytes using OpenAI audio transcriptions API.
    Returns transcript text, or '' on failure. Never raises.
    """
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning('[transcribe] Skipping %s: size %d exceeds 25 MB limit', filename, len(audio_bytes))
        return ''

    try:
        files = {'file': (filename, audio_bytes)}
        data: dict = {'model': model, 'response_format': 'text'}
        if prompt:
            data['prompt'] = prompt

        resp = httpx.post(
            'https://api.openai.com/v1/audio/transcriptions',
            headers={'Authorization': f'Bearer {openai_api_key}'},
            files=files,
            data=data,
            timeout=60,
        )
        if not resp.is_success:
            logger.error('[transcribe] OpenAI error for %s: HTTP %s — %s', filename, resp.status_code, resp.text[:200])
            return ''
        return resp.text.strip()
    except Exception as exc:
        logger.error('[transcribe] Unexpected error transcribing %s: %s', filename, exc)
        return ''
