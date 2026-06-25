"""
Analyze a transcript using OpenAI to extract structured fields.
Port of src/lib/analyzeAudio.ts.
"""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_PROMPT = (
    'Analyze this transcript. Return a flat JSON object with string values only '
    '— no nested objects, no explanation, just valid JSON.'
)


def analyze_audio_text(
    transcript: str,
    openai_api_key: str,
    model: str = 'gpt-4o-mini',
    prompt: str = DEFAULT_PROMPT,
) -> dict[str, str] | None:
    """
    Sends a transcript to OpenAI and returns extracted fields as a flat dict.
    Returns None on failure. Never raises.
    """
    if not transcript.strip():
        return None

    try:
        resp = httpx.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {openai_api_key}', 'Content-Type': 'application/json'},
            json={
                'model': model,
                'messages': [
                    {
                        'role': 'system',
                        'content': 'You analyze transcripts and extract structured data. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.',
                    },
                    {'role': 'user', 'content': f'{prompt}\n\nTranscript:\n{transcript}'},
                ],
                'max_tokens': 512,
                'response_format': {'type': 'json_object'},
            },
            timeout=30,
        )
        if not resp.is_success:
            logger.error('[analyze-audio] OpenAI error: HTTP %s — %s', resp.status_code, resp.text[:200])
            return None

        content = (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        if not content:
            return None

        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            logger.warning('[analyze-audio] AI response was not a plain object')
            return None

        result = {k: str(v) for k, v in parsed.items() if v is not None}
        return result or None
    except Exception as exc:
        logger.error('[analyze-audio] Unexpected error: %s', exc)
        return None
