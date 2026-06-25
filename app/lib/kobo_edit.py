"""
Kobo submission edit-back helpers.
Port of src/lib/koboEdit.ts.
"""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

EU_HOSTNAME = 'eu.kobotoolbox.org'


def resolve_kobo_edit_token(server: str, tokens: dict[str, str]) -> str:
    try:
        from urllib.parse import urlparse
        host = urlparse(server).hostname or ''
        return tokens['eu'] if host == EU_HOSTNAME else tokens['global']
    except Exception:
        return tokens['global']


def resolve_submission_id(server: str, uid: str, uuid: str, token: str) -> int | None:
    """Queries Kobo to find the numeric _id for a submission identified by _uuid."""
    try:
        query = json.dumps({'_uuid': uuid})
        fields = json.dumps(['_id'])
        url = f'{server}/api/v2/assets/{uid}/data.json'
        resp = httpx.get(
            url,
            params={'query': query, 'fields': fields},
            headers={'Authorization': f'Token {token}'},
            timeout=15,
        )
        if not resp.is_success:
            logger.error('[edit] resolveSubmissionId failed: HTTP %s', resp.status_code)
            return None
        data = resp.json()
        results = data.get('results') or []
        return results[0].get('_id') if results else None
    except Exception as exc:
        logger.error('[edit] resolveSubmissionId error: %s', exc)
        return None


def edit_submission(
    server: str, uid: str, submission_id: int, data: dict[str, str], token: str
) -> dict:
    """Patches field values onto an existing Kobo submission via the bulk-edit endpoint."""
    try:
        url = f'{server}/api/v2/assets/{uid}/data/bulk/'
        payload_inner = json.dumps({'submission_ids': [submission_id], 'data': data})
        resp = httpx.patch(
            url,
            json={'payload': payload_inner},
            headers={'Authorization': f'Token {token}'},
            timeout=15,
        )
        if not resp.is_success:
            text = resp.text[:500]
            logger.error('[edit] editSubmission failed: HTTP %s — %s', resp.status_code, text[:200])
            return {'ok': False, 'http_status': resp.status_code, 'error': text}
        return {'ok': True, 'http_status': resp.status_code}
    except Exception as exc:
        logger.error('[edit] editSubmission error: %s', exc)
        return {'ok': False, 'http_status': 0, 'error': str(exc)}


def update_validation_status(
    server: str, uid: str, submission_id: int, status: str, token: str
) -> dict:
    """Sets the validation status of a Kobo submission."""
    try:
        url = f'{server}/api/v2/assets/{uid}/data/{submission_id}/validation_status/'
        resp = httpx.patch(
            url,
            data={'validation_status.uid': status},
            headers={'Authorization': f'Token {token}'},
            timeout=15,
        )
        if not resp.is_success:
            text = resp.text[:500]
            logger.error('[validate] updateValidationStatus failed: HTTP %s — %s', resp.status_code, text[:200])
            return {'ok': False, 'http_status': resp.status_code, 'error': text}
        return {'ok': True, 'http_status': resp.status_code}
    except Exception as exc:
        logger.error('[validate] updateValidationStatus error: %s', exc)
        return {'ok': False, 'http_status': 0, 'error': str(exc)}
