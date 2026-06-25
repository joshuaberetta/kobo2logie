"""
Extract structured fields from free-text answers using OpenAI.
Port of src/lib/extractText.ts.
"""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_PROMPT = (
    'Extract named entities (people, locations, organizations) and any other key facts from this text. '
    'Return a flat JSON object with string values only — no nested objects, no explanation, just valid JSON.'
)


def extract_text_fields(
    text: str,
    openai_api_key: str,
    model: str = 'gpt-4o-mini',
    prompt: str = DEFAULT_PROMPT,
) -> dict[str, str] | None:
    """
    Sends free-text to OpenAI and returns extracted fields as a flat dict.
    Returns None on failure. Never raises.
    """
    if not text.strip():
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
                        'content': 'You extract structured data from free-text answers. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.',
                    },
                    {'role': 'user', 'content': f'{prompt}\n\nText:\n{text}'},
                ],
                'max_tokens': 512,
                'response_format': {'type': 'json_object'},
            },
            timeout=30,
        )
        if not resp.is_success:
            logger.error('[extract-text] OpenAI error: HTTP %s — %s', resp.status_code, resp.text[:200])
            return None

        content = (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        if not content:
            return None

        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            logger.warning('[extract-text] AI response was not a plain object')
            return None

        return {k: str(v) for k, v in parsed.items() if v is not None}
    except Exception as exc:
        logger.error('[extract-text] Unexpected error: %s', exc)
        return None
