"""
OpenAI vision image → structured field extraction.
Port of src/lib/extract.ts.
"""

import base64
import json
import logging

import httpx

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

DEFAULT_PROMPT = (
    'Extract structured data from this image. Return a flat JSON object with string values only '
    '— no nested objects, no explanation, just valid JSON.'
)


def extract_fields(
    image_bytes: bytes,
    filename: str,
    openai_api_key: str,
    model: str = 'gpt-4o-mini',
    prompt: str = DEFAULT_PROMPT,
) -> dict[str, str] | None:
    """
    Sends an image to OpenAI vision and returns extracted fields as a flat dict.
    Returns None on failure. Never raises.
    """
    if len(image_bytes) > MAX_IMAGE_BYTES:
        logger.warning('[extract] Skipping %s: size %d exceeds 20 MB limit', filename, len(image_bytes))
        return None

    try:
        b64 = base64.b64encode(image_bytes).decode('ascii')
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'jpeg'
        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
        mime_type = mime_map.get(ext, 'image/jpeg')
        data_url = f'data:{mime_type};base64,{b64}'

        payload = {
            'model': model,
            'messages': [
                {
                    'role': 'system',
                    'content': 'You extract structured data from images. Respond with valid JSON only — a flat object with string values. No markdown, no code fences, no explanation.',
                },
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': prompt},
                        {'type': 'image_url', 'image_url': {'url': data_url, 'detail': 'auto'}},
                    ],
                },
            ],
            'max_tokens': 512,
            'response_format': {'type': 'json_object'},
        }
        resp = httpx.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {openai_api_key}', 'Content-Type': 'application/json'},
            json=payload,
            timeout=30,
        )
        if not resp.is_success:
            logger.error('[extract] OpenAI error for %s: HTTP %s — %s', filename, resp.status_code, resp.text[:200])
            return None

        content = (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        if not content:
            return None

        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            logger.warning('[extract] AI response for %s was not a plain object', filename)
            return None

        result = {k: str(v) for k, v in parsed.items() if v is not None}
        return result or None
    except Exception as exc:
        logger.error('[extract] Unexpected error extracting from %s: %s', filename, exc)
        return None
