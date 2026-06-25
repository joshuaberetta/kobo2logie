"""
PDF generation via kobo2pdf.imtools.info.
Port of src/lib/pdfReport.ts.
"""

import base64
import logging
from datetime import date

import httpx

from .kobo import is_allowed_media_host

logger = logging.getLogger(__name__)

KOBO2PDF_URL = 'https://kobo2pdf.imtools.info'


def render_pdf(
    cfg: dict,
    submission: dict,
    kobo_server: str,
    kobo_token: str,
) -> dict:
    """
    Fetches image attachments and calls kobo2pdf to render a PDF.
    Returns {'ok': bool, 'error': str?, 'pdf_bytes': bytes?}.
    """
    # 1. Fetch image attachments to embed
    pdf_attachments = []
    for att in (submission.get('_attachments') or []):
        if att.get('is_deleted'):
            continue
        mimetype = str(att.get('mimetype') or '')
        if not mimetype.startswith('image/'):
            continue
        download_url = str(att.get('download_url') or '')
        if not download_url or not is_allowed_media_host(download_url, kobo_server):
            continue
        try:
            media_resp = httpx.get(
                download_url,
                headers={'Authorization': f'Token {kobo_token}'},
                timeout=30,
            )
            if not media_resp.is_success:
                logger.error('[pdf] Failed to fetch attachment %s: %s', att.get('media_file_basename'), media_resp.status_code)
                continue
            pdf_attachments.append({
                'filename': str(att.get('media_file_basename') or att.get('filename') or ''),
                'content_type': mimetype,
                'content': base64.b64encode(media_resp.content).decode('ascii'),
            })
        except Exception as exc:
            logger.error('[pdf] Error fetching attachment %s: %s', att.get('media_file_basename'), exc)

    # 2. Call the kobo2pdf render service
    try:
        body: dict = {
            'template': cfg.get('template') or 'submission',
            'data': submission,
            'meta': {
                'reportDate': date.today().isoformat(),
                **({'formTitle': cfg['formTitle']} if cfg.get('formTitle') else {}),
            },
        }
        if pdf_attachments:
            body['attachments'] = pdf_attachments

        render_resp = httpx.post(
            f'{KOBO2PDF_URL}/render',
            json=body,
            timeout=60,
        )
        if not render_resp.is_success:
            return {'ok': False, 'error': f'kobo2pdf error {render_resp.status_code}: {render_resp.text[:200]}'}

        content_type = render_resp.headers.get('content-type', '')
        if 'application/pdf' not in content_type:
            return {'ok': False, 'error': f'kobo2pdf returned unexpected content-type: {content_type}'}

        return {'ok': True, 'pdf_bytes': render_resp.content}
    except Exception as exc:
        return {'ok': False, 'error': f'Failed to reach kobo2pdf service: {exc}'}
