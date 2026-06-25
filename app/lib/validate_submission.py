"""
AI-based Kobo submission validation.
Port of src/lib/validateSubmission.ts.
"""

import json
import logging
import re

import httpx

logger = logging.getLogger(__name__)

VALID_DECISIONS = {'approved', 'not_approved', 'on_hold'}


def call_validation_ai(
    api_key: str,
    submission: dict,
    instructions: str,
    options: dict[str, str],
) -> dict | None:
    """
    Calls OpenAI to determine validation status of a submission.
    Returns {'decision': str, 'reasoning': str} or None on failure.
    """
    system_prompt = '\n'.join([
        'You are a submission reviewer. Review the following form submission and decide on its validation status.',
        '',
        f'Overall context: {instructions}' if instructions else '',
        '',
        'Criteria for each status:',
        f'- Approved: {options.get("approved") or "The submission meets all requirements."}',
        f'- Not Approved: {options.get("notApproved") or "The submission does not meet requirements."}',
        f'- On Hold: {options.get("onHold") or "The submission needs further review."}',
        '',
        'Respond with valid JSON only — no markdown fences, no extra text:',
        '{"decision":"approved"|"not_approved"|"on_hold","reasoning":"<explanation>"}',
    ])

    try:
        resp = httpx.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': 'gpt-4o-mini',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': f'Submission data:\n{json.dumps(submission, indent=2)}'},
                ],
                'max_tokens': 512,
            },
            timeout=30,
        )
        if not resp.is_success:
            logger.error('[validate] OpenAI error %s', resp.status_code)
            return None

        raw = (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        # Strip markdown code fences if present
        cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s*```$', '', cleaned).strip()

        parsed = json.loads(cleaned)
        decision = parsed.get('decision', '')
        if decision not in VALID_DECISIONS:
            logger.error('[validate] Unexpected AI response shape: %s', cleaned[:200])
            return None

        return {
            'decision': decision,
            'reasoning': str(parsed.get('reasoning', '')),
        }
    except json.JSONDecodeError:
        logger.error('[validate] Failed to parse AI response')
        return None
    except Exception as exc:
        logger.error('[validate] callValidationAI error: %s', exc)
        return None
