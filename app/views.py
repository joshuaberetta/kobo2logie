import base64
import json
import logging
import re
import threading
import time

import httpx
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .lib.evaluate_condition import evaluate_condition
from .lib.forward import forward_submission
from .lib.geocode import geocode_address, geocode_submission
from .lib.kobo import is_allowed_media_host
from .lib.kobo_edit import (
    edit_submission,
    resolve_kobo_edit_token,
    resolve_submission_id,
    update_validation_status,
)
from .lib.pdf_report import render_pdf
from .lib.submission_value import get_payload_value
from .lib.validate_submission import call_validation_ai
from .models import FormConfig, SubmissionLog

logger = logging.getLogger(__name__)

ALLOWED_SERVERS = {
    'https://kf.kobotoolbox.org',
    'https://eu.kobotoolbox.org',
}

LOG_MAX_ENTRIES = 100
_MISSING = object()  # sentinel for "key not present in request"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_config(uid: str) -> dict:
    try:
        return FormConfig.objects.get(uid=uid).config
    except FormConfig.DoesNotExist:
        return {}


def _save_config(uid: str, config: dict) -> None:
    obj, _ = FormConfig.objects.get_or_create(uid=uid)
    obj.config = config
    obj.save()


def _write_log(uid: str, uuid: str, submission_id, data: dict) -> None:
    ts = int(time.time() * 1000)
    SubmissionLog.objects.create(
        form_uid=uid,
        ts=ts,
        uuid=uuid or '',
        submission_id=submission_id,
        data=data,
    )
    # Enforce 100-entry cap per form
    overflow_ids = list(
        SubmissionLog.objects
        .filter(form_uid=uid)
        .order_by('-ts')
        .values_list('id', flat=True)[LOG_MAX_ENTRIES:]
    )
    if overflow_ids:
        SubmissionLog.objects.filter(id__in=overflow_ids).delete()


def _push_to_channel(uid: str, submission: dict) -> None:
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    layer = get_channel_layer()
    if layer:
        try:
            async_to_sync(layer.group_send)(
                f'form_{uid}',
                {'type': 'submission.push', 'data': json.dumps(submission)},
            )
        except Exception as exc:
            logger.error('[ws] Failed to push to channel for %s: %s', uid, exc)


def _is_valid_condition(c) -> bool:
    if not isinstance(c, dict):
        return False
    return (
        c.get('type') == 'group'
        and c.get('combinator') in ('and', 'or')
        and isinstance(c.get('rules'), list)
    )


def _extract_email_addresses(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        out = []
        for item in value:
            out.extend(_extract_email_addresses(item))
        return out
    if not isinstance(value, str):
        return []
    return [m.strip() for m in re.findall(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', value, re.IGNORECASE)]


def _resolve_email_recipients(cfg: dict, payload: dict) -> dict:
    def collect(static_emails, xpaths):
        out = []
        seen = set()
        for email in (static_emails or []):
            email = email.strip()
            if email and email.lower() not in seen:
                seen.add(email.lower())
                out.append(email)
        for xpath in (xpaths or []):
            for email in _extract_email_addresses(get_payload_value(payload, xpath)):
                if email.lower() not in seen:
                    seen.add(email.lower())
                    out.append(email)
        return out

    to = collect(cfg.get('to'), cfg.get('toXPaths'))
    cc = collect(cfg.get('cc'), cfg.get('ccXPaths'))
    bcc = collect(cfg.get('bcc'), cfg.get('bccXPaths'))
    result: dict = {'to': to}
    if cc:
        result['cc'] = cc
    if bcc:
        result['bcc'] = bcc
    return result


def _send_resend_email(api_key: str, from_email: str, cfg: dict, html_body: str, attachments=None) -> None:
    payload: dict = {
        'from': from_email,
        'to': cfg['to'],
        'subject': cfg['subject'],
        'html': html_body,
    }
    if cfg.get('cc'):
        payload['cc'] = cfg['cc']
    if cfg.get('bcc'):
        payload['bcc'] = cfg['bcc']
    if attachments:
        payload['attachments'] = attachments

    resp = httpx.post(
        'https://api.resend.com/emails',
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        json=payload,
        timeout=15,
    )
    if not resp.is_success:
        logger.error('[email] Resend error %s: %s', resp.status_code, resp.text[:200])


def _generate_email_body(api_key: str, instructions: str, submission: dict) -> str:
    system_prompt = '\n'.join([
        'You are an assistant that generates HTML email bodies for form submission notifications.',
        'Format the output as a complete HTML fragment (no <html>/<head>/<body> tags — just the inner content).',
        'Use inline styles. Keep it clean and professional.',
        instructions,
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
                'max_tokens': 1024,
            },
            timeout=30,
        )
        if not resp.is_success:
            logger.error('[email/ai] OpenAI error %s', resp.status_code)
            return f'<p>A new submission was received.</p><pre>{json.dumps(submission, indent=2)}</pre>'
        return (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip() or '<p>A new submission was received.</p>'
    except Exception as exc:
        logger.error('[email/ai] Error generating body: %s', exc)
        return '<p>A new submission was received.</p>'


def _run_pipeline(uid: str, submission: dict, config: dict) -> None:
    """Fire-and-forget pipeline — runs in a daemon thread."""
    forward_url_raw = config.get('forwardUrl') or ''
    forward_token = config.get('forwardToken') or ''
    forward_to_logie = config.get('forwardToLogie', False)
    fields = config.get('fields') or []
    transcribe = config.get('transcribe')
    extract = config.get('extract')
    analyze_audio = config.get('analyzeAudio')
    extract_text = config.get('extractText')
    forward_media = config.get('forwardMedia')
    append_values = config.get('appendValues') or []
    edit_original = config.get('editOriginal', False)
    geocode = config.get('geocode', False)
    geocode_field = config.get('geocodeField') or ''
    geocode_address_fields = config.get('geocodeAddressFields') or []
    server = config.get('server') or ''
    email_notification = config.get('emailNotification')
    validate_submission_cfg = config.get('validateSubmission')
    failure_notification = config.get('failureNotification')
    forward_condition = config.get('forwardCondition')
    geocode_condition = config.get('geocodeCondition')

    forward_url = (settings.LOGIE_API_URL or forward_url_raw) if forward_to_logie else forward_url_raw
    forward_token_eff = None if forward_to_logie else (forward_token or None)
    logie_api_key = (settings.LOGIE_API_KEY or None) if forward_to_logie else None
    openai_api_key = settings.OPENAI_API_KEY or None

    # Build filtered payload
    json_payload = None
    if forward_url:
        if fields:
            always = {'_uuid', '_submission_time'}
            all_fields = list(always | set(fields))
            filtered = {f: submission[f] for f in all_fields if f in submission}
            json_payload = filtered if filtered else None

        if append_values:
            meta = {kv['key']: kv['value'] for kv in append_values}
            if json_payload is None:
                json_payload = dict(submission)
            json_payload['_metadata'] = meta

    # ── Geocode coordinates ────────────────────────────────────────────────
    geo_fields: dict = {}
    geocode_ok = None
    geocode_error = None

    if geocode and evaluate_condition(geocode_condition, submission):
        import math
        geo_lat = float('nan')
        geo_lon = float('nan')
        if geocode_field:
            raw = submission.get(geocode_field)
            if isinstance(raw, str) and raw.strip():
                parts = raw.strip().split()
                try:
                    geo_lat = float(parts[0])
                    geo_lon = float(parts[1])
                except (IndexError, ValueError):
                    pass
        else:
            geo_loc = submission.get('_geolocation')
            if isinstance(geo_loc, list) and len(geo_loc) >= 2:
                try:
                    geo_lat = float(geo_loc[0])
                    geo_lon = float(geo_loc[1])
                except (TypeError, ValueError):
                    pass

        if not math.isnan(geo_lat) and not math.isnan(geo_lon):
            try:
                raw_geo = geocode_submission(geo_lat, geo_lon)
                prefix = geocode_field or ''
                for k, v in raw_geo.items():
                    geo_fields[f'{prefix}{k}'] = v
                geocode_ok = True
            except Exception as exc:
                geocode_ok = False
                geocode_error = str(exc)
        else:
            geocode_ok = False
            geocode_error = 'No valid coordinates found'

    # ── Geocode address text fields ────────────────────────────────────────
    geocode_address_steps: dict = {}
    address_geo_fields: dict = {}

    for xpath in geocode_address_fields:
        address_value = submission.get(xpath)
        if not isinstance(address_value, str) or not address_value.strip():
            geocode_address_steps[xpath] = {'ok': False, 'error': 'No address value found'}
            continue
        try:
            raw = geocode_address(address_value.strip())
            if not raw:
                geocode_address_steps[xpath] = {'ok': False, 'error': 'Address could not be geocoded'}
                continue
            written_keys = []
            for k, v in raw.items():
                prefixed_key = f'{xpath}{k}'
                address_geo_fields[prefixed_key] = v
                written_keys.append(prefixed_key)
            geocode_address_steps[xpath] = {'ok': True, 'keys': written_keys}
        except Exception as exc:
            geocode_address_steps[xpath] = {'ok': False, 'error': str(exc)}

    all_geo_fields = {**geo_fields, **address_geo_fields}
    enriched_payload = ({**(json_payload if json_payload is not None else submission), **all_geo_fields}) if all_geo_fields else json_payload

    # ── Step 1: Forward + enrich ───────────────────────────────────────────
    fwd_result = None
    if forward_url or transcribe or extract or analyze_audio or extract_text:
        skip_post = bool(forward_url) and not evaluate_condition(forward_condition, submission)
        fwd_result = forward_submission(
            submission=submission,
            forward_url=None if skip_post else (forward_url or None),
            kobo_base_url=settings.DEFAULT_KOBO_BASE_URL,
            tokens={'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU},
            json_payload=enriched_payload,
            forward_token=forward_token_eff,
            transcribe_config=transcribe or None,
            openai_api_key=openai_api_key,
            forward_media=forward_media or None,
            extract_config=extract or None,
            analyze_audio_config=analyze_audio or None,
            extract_text_config=extract_text or None,
            logie_api_key=logie_api_key,
        )

    # ── Step 2: Edit original ──────────────────────────────────────────────
    edit_ok = None
    edit_http_status = None
    edit_error = None
    resolved_id = None
    kobo_edit_token = None

    needs_id = (edit_original or bool(validate_submission_cfg)) and bool(server) and bool(submission.get('_uuid'))
    if needs_id:
        kobo_edit_token = resolve_kobo_edit_token(server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})
        resolved_id = resolve_submission_id(server, uid, submission['_uuid'], kobo_edit_token)

    if edit_original and server and submission.get('_uuid'):
        edit_data: dict = {}
        for kv in append_values:
            if kv['key'] != '_uuid':
                edit_data[kv['key']] = kv['value']
        for k, v in (fwd_result or {}).get('enrichment', {}).items():
            if k != '_uuid':
                edit_data[k] = v

        if edit_data:
            if resolved_id is not None:
                result = edit_submission(server, uid, resolved_id, edit_data, kobo_edit_token)
                edit_ok = result['ok']
                edit_http_status = result.get('http_status')
                edit_error = result.get('error')
            else:
                edit_ok = False
                edit_error = 'Could not resolve _id from _uuid'

    # ── Step 3: AI validation ──────────────────────────────────────────────
    validate_ok = None
    validate_http_status = None
    validate_error = None

    if validate_submission_cfg and evaluate_condition(validate_submission_cfg.get('condition'), submission) and server and submission.get('_uuid') and openai_api_key:
        v_token = kobo_edit_token or resolve_kobo_edit_token(server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})
        val_id = resolved_id if resolved_id is not None else resolve_submission_id(server, uid, submission['_uuid'], v_token)
        if val_id is not None:
            ai_result = call_validation_ai(openai_api_key, submission, validate_submission_cfg.get('instructions', ''), validate_submission_cfg.get('options', {}))
            if ai_result:
                status_map = {
                    'approved': 'validation_status_approved',
                    'not_approved': 'validation_status_not_approved',
                    'on_hold': 'validation_status_on_hold',
                }
                val_result = update_validation_status(server, uid, val_id, status_map[ai_result['decision']], v_token)
                validate_ok = val_result['ok']
                validate_http_status = val_result.get('http_status')
                validate_error = val_result.get('error')
                if validate_submission_cfg.get('includeReasoning') and ai_result.get('reasoning'):
                    edit_submission(server, uid, val_id, {'_ai_validation_reasoning': ai_result['reasoning']}, v_token)
            else:
                validate_ok = False
                validate_error = 'AI returned no result'
        else:
            validate_ok = False
            validate_error = 'Could not resolve _id from _uuid'

    # ── Build log entry ────────────────────────────────────────────────────
    fwd_steps = (fwd_result or {}).get('steps') or {}
    log_data: dict = {
        'ok': (fwd_result or {}).get('ok', True),
    }
    for k in ('http_status', 'response_body', 'error'):
        if (fwd_result or {}).get(k) is not None:
            # Normalize key names to camelCase for log compatibility
            camel = {'http_status': 'httpStatus', 'response_body': 'responseBody'}.get(k, k)
            log_data[camel] = fwd_result[k]

    opt = lambda k, v: {k: v} if v is not None else {}
    log_data.update({
        **opt('editOk', edit_ok),
        **opt('editHttpStatus', edit_http_status),
        **opt('editError', edit_error),
        **opt('validateOk', validate_ok),
        **opt('validateHttpStatus', validate_http_status),
        **opt('validateError', validate_error),
        **({'transcribeSteps': fwd_steps['transcribe']} if fwd_steps.get('transcribe') else {}),
        **({'analyzeAudioSteps': fwd_steps['analyzeAudio']} if fwd_steps.get('analyzeAudio') else {}),
        **({'extractSteps': fwd_steps['extract']} if fwd_steps.get('extract') else {}),
        **({'extractTextSteps': fwd_steps['extractText']} if fwd_steps.get('extractText') else {}),
        **opt('geocodeOk', geocode_ok),
        **opt('geocodeError', geocode_error),
        **({'geocodeAddressSteps': geocode_address_steps} if geocode_address_steps else {}),
    })

    # ── Failure notification ───────────────────────────────────────────────
    if not log_data.get('ok') and failure_notification and settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL:
        uuid = submission.get('_uuid', 'unknown')
        error_detail = log_data.get('error') or (f'HTTP {log_data["httpStatus"]}' if log_data.get('httpStatus') else 'Unknown error')
        subj = failure_notification.get('subject', '').replace('{{_uuid}}', uuid)
        body_text = (failure_notification.get('body', '') or error_detail).replace('{{_uuid}}', uuid).replace('{{error}}', error_detail)
        escaped = body_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
        html_body = f'<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">{escaped}</div>'
        try:
            _send_resend_email(settings.RESEND_API_KEY, settings.RESEND_FROM_EMAIL, {
                'to': failure_notification.get('to', []),
                'subject': subj,
                **({'cc': failure_notification['cc']} if failure_notification.get('cc') else {}),
                **({'bcc': failure_notification['bcc']} if failure_notification.get('bcc') else {}),
            }, html_body)
            log_data['failureEmailOk'] = True
        except Exception as exc:
            log_data['failureEmailOk'] = False
            log_data['failureEmailError'] = str(exc)

    # ── Email notification ─────────────────────────────────────────────────
    if email_notification and evaluate_condition(email_notification.get('condition'), submission) and settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL:
        email_payload: dict = {
            **(json_payload if json_payload is not None else submission),
            **((fwd_result or {}).get('enrichment') or {}),
        }

        def fill(s: str) -> str:
            def replacer(m):
                val = get_payload_value(email_payload, m.group(1))
                return val if isinstance(val, str) else (json.dumps(val) if val is not None else '')
            return re.sub(r'\{\{([^{}]+)\}\}', replacer, s)

        subject = fill(email_notification.get('subject', ''))
        ai_body_cfg = email_notification.get('aiBody')
        if ai_body_cfg and openai_api_key:
            html_body = _generate_email_body(openai_api_key, ai_body_cfg.get('instructions', ''), email_payload)
        else:
            text = fill(email_notification.get('body', '') or '')
            escaped = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
            html_body = f'<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">{escaped}</div>'

        email_attachments = []
        kobo_server = server or settings.DEFAULT_KOBO_BASE_URL
        att_token = resolve_kobo_edit_token(kobo_server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})

        for xpath in (email_notification.get('attachments') or []):
            att = next((a for a in (submission.get('_attachments') or []) if not a.get('is_deleted') and a.get('question_xpath') == xpath), None)
            if not att or not is_allowed_media_host(att.get('download_url', ''), kobo_server):
                continue
            try:
                mr = httpx.get(att['download_url'], headers={'Authorization': f'Token {att_token}'}, timeout=30)
                if mr.is_success:
                    email_attachments.append({'filename': att['media_file_basename'], 'content': base64.b64encode(mr.content).decode('ascii')})
            except Exception as exc:
                logger.error('[email] Error fetching attachment: %s', exc)

        if email_notification.get('pdfReport'):
            enriched_for_pdf = {**submission, **((fwd_result or {}).get('enrichment') or {}), **all_geo_fields}
            pdf_server = server or settings.DEFAULT_KOBO_BASE_URL
            pdf_token = resolve_kobo_edit_token(pdf_server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})
            pdf_result = render_pdf(email_notification['pdfReport'], enriched_for_pdf, pdf_server, pdf_token)
            if pdf_result['ok'] and pdf_result.get('pdf_bytes'):
                email_attachments.append({'filename': f'submission-{submission.get("_uuid", "submission")}.pdf', 'content': base64.b64encode(pdf_result['pdf_bytes']).decode('ascii')})
            else:
                logger.error('[pdf] %s', pdf_result.get('error'))

        recipients = _resolve_email_recipients(email_notification, email_payload)
        if not recipients.get('to'):
            log_data['emailOk'] = False
            log_data['emailError'] = 'No valid To recipients resolved'
        else:
            try:
                _send_resend_email(settings.RESEND_API_KEY, settings.RESEND_FROM_EMAIL, {**recipients, 'subject': subject}, html_body, email_attachments or None)
                log_data['emailOk'] = True
            except Exception as exc:
                log_data['emailOk'] = False
                log_data['emailError'] = str(exc)

    # ── Step 9: Write geocoded fields back to Kobo ─────────────────────────
    if all_geo_fields and submission.get('_uuid'):
        geo_server = server or settings.DEFAULT_KOBO_BASE_URL
        geo_token = resolve_kobo_edit_token(geo_server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})
        geo_id = resolve_submission_id(geo_server, uid, submission['_uuid'], geo_token)
        if geo_id is not None:
            edit_submission(geo_server, uid, geo_id, all_geo_fields, geo_token)

    _write_log(uid, submission.get('_uuid', ''), submission.get('_id'), log_data)


# ── API views ─────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def hook(request, uid):
    max_bytes = getattr(settings, 'MAX_BODY_BYTES', 1_048_576)
    content_length = int(request.META.get('CONTENT_LENGTH') or 0)
    if content_length > max_bytes:
        return Response('Payload too large', status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    body = request.data
    if not isinstance(body, dict):
        return Response('Expected a JSON object', status=status.HTTP_400_BAD_REQUEST)

    _push_to_channel(uid, body)

    config = _get_config(uid)
    if config and (
        config.get('forwardUrl') or config.get('forwardToLogie') or
        config.get('editOriginal') or config.get('geocode') or
        config.get('geocodeAddressFields') or config.get('transcribe') or
        config.get('extract') or config.get('analyzeAudio') or
        config.get('extractText') or config.get('emailNotification') or
        config.get('validateSubmission')
    ):
        threading.Thread(target=_run_pipeline, args=(uid, body, config), daemon=True).start()

    return Response('OK')


@api_view(['GET'])
@permission_classes([AllowAny])
def logs(request, uid):
    page = int(request.query_params.get('page', 1))
    page_size = min(int(request.query_params.get('page_size', 20)), 100)
    offset = (page - 1) * page_size

    qs = SubmissionLog.objects.filter(form_uid=uid).order_by('-ts')
    total = qs.count()
    entries = qs[offset: offset + page_size]

    results = [
        {'id': e.id, 'ts': e.ts, 'uuid': e.uuid, 'submission_id': e.submission_id, **e.data}
        for e in entries
    ]
    return Response({'total': total, 'page': page, 'page_size': page_size, 'results': results})


@api_view(['GET'])
@permission_classes([AllowAny])
def media_proxy(request):
    url = request.query_params.get('url', '')
    if not url:
        return Response({'error': 'url parameter required'}, status=status.HTTP_400_BAD_REQUEST)
    if not is_allowed_media_host(url, settings.DEFAULT_KOBO_BASE_URL):
        return Response({'error': 'Host not allowed'}, status=status.HTTP_403_FORBIDDEN)

    token = settings.KOBO_API_TOKEN_GLOBAL
    try:
        resp = httpx.get(url, headers={'Authorization': f'Token {token}'}, timeout=30)
        from django.http import HttpResponse
        return HttpResponse(resp.content, content_type=resp.headers.get('content-type', 'application/octet-stream'), status=resp.status_code)
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['POST'])
@permission_classes([AllowAny])
def retry(request, uid):
    uuid = request.data.get('uuid')
    if not uuid:
        return Response({'error': 'uuid is required'}, status=status.HTTP_400_BAD_REQUEST)

    config = _get_config(uid)
    server = config.get('server') or settings.DEFAULT_KOBO_BASE_URL
    token = resolve_kobo_edit_token(server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})

    try:
        resp = httpx.get(
            f'{server}/api/v2/assets/{uid}/data.json',
            params={'query': json.dumps({'_uuid': uuid})},
            headers={'Authorization': f'Token {token}'},
            timeout=15,
        )
        if not resp.is_success:
            return Response({'error': f'Kobo returned HTTP {resp.status_code}'}, status=status.HTTP_502_BAD_GATEWAY)
        results = resp.json().get('results') or []
        if not results:
            return Response({'error': 'Submission not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

    submission = results[0]
    _push_to_channel(uid, submission)
    if config:
        threading.Thread(target=_run_pipeline, args=(uid, submission, config), daemon=True).start()
    return Response({'ok': True})


# ── Configure views ───────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def configure_rest_service(request):
    server = request.data.get('server', '')
    uid = request.data.get('uid', '')
    token = request.data.get('token', '')

    if server not in ALLOWED_SERVERS:
        return Response({'error': 'Invalid server'}, status=status.HTTP_400_BAD_REQUEST)
    if not uid or not token:
        return Response({'error': 'uid and token are required'}, status=status.HTTP_400_BAD_REQUEST)

    config = _get_config(uid)
    config['server'] = server
    _save_config(uid, config)

    scheme = request.scheme
    host = request.get_host()
    webhook_url = f'{scheme}://{host}/api/hook/{uid}/'
    hooks_url = f'{server}/api/v2/assets/{uid}/hooks/'

    try:
        list_resp = httpx.get(hooks_url, headers={'Authorization': f'Token {token}'}, timeout=10)
        if not list_resp.is_success:
            from django.http import HttpResponse
            return HttpResponse(list_resp.content, status=list_resp.status_code, content_type=list_resp.headers.get('content-type', 'application/json'))

        existing = next((h for h in list_resp.json().get('results', []) if h.get('name') == 'LogIE Integration'), None)
        if existing:
            return Response({'already_exists': True, 'uid': existing.get('uid'), 'url': existing.get('url')})

        create_resp = httpx.post(
            hooks_url,
            headers={'Authorization': f'Token {token}', 'Content-Type': 'application/json'},
            json={
                'name': 'LogIE Integration',
                'endpoint': webhook_url,
                'active': True,
                'subset_fields': [],
                'email_notification': True,
                'export_type': 'json',
                'auth_level': 'no_auth',
                'settings': {'custom_headers': {}},
                'payload_template': '',
            },
            timeout=10,
        )
        from django.http import HttpResponse
        return HttpResponse(create_resp.content, status=create_resp.status_code, content_type=create_resp.headers.get('content-type', 'application/json'))
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['POST'])
@permission_classes([AllowAny])
def configure_permissions(request):
    server = request.data.get('server', '')
    uid = request.data.get('uid', '')
    token = request.data.get('token', '')

    if server not in ALLOWED_SERVERS:
        return Response({'error': 'Invalid server'}, status=status.HTTP_400_BAD_REQUEST)
    if not uid or not token:
        return Response({'error': 'uid and token are required'}, status=status.HTTP_400_BAD_REQUEST)

    perms_url = f'{server}/api/v2/assets/{uid}/permission-assignments/'
    new_user = f'{server}/api/v2/users/wfp_logie/'
    new_perm = f'{server}/api/v2/permissions/view_submissions/'

    try:
        asset_resp = httpx.get(f'{server}/api/v2/assets/{uid}/', headers={'Authorization': f'Token {token}'}, timeout=10)
        if not asset_resp.is_success:
            from django.http import HttpResponse
            return HttpResponse(asset_resp.content, status=asset_resp.status_code, content_type=asset_resp.headers.get('content-type', 'application/json'))

        owner_username = asset_resp.json().get('owner__username', '')
        owner_user_url = f'{server}/api/v2/users/{owner_username}/'

        list_resp = httpx.get(perms_url, headers={'Authorization': f'Token {token}'}, timeout=10)
        if not list_resp.is_success:
            from django.http import HttpResponse
            return HttpResponse(list_resp.content, status=list_resp.status_code, content_type=list_resp.headers.get('content-type', 'application/json'))

        existing = list_resp.json()
        if any(p.get('user') == new_user and p.get('permission') == new_perm for p in existing):
            return Response({'already_exists': True})

        merged = [{'user': p['user'], 'permission': p['permission']} for p in existing if p.get('user') != owner_user_url]
        merged.append({'user': new_user, 'permission': new_perm})

        bulk_resp = httpx.post(f'{perms_url}bulk/', headers={'Authorization': f'Token {token}', 'Content-Type': 'application/json'}, json=merged, timeout=10)
        from django.http import HttpResponse
        return HttpResponse(bulk_resp.content, status=bulk_resp.status_code, content_type=bulk_resp.headers.get('content-type', 'application/json'))
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def configure_project(request, uid):
    if request.method == 'GET':
        config = _get_config(uid)
        return Response({
            'server': config.get('server', ''),
            'forwardUrl': config.get('forwardUrl', ''),
            'forwardToken': config.get('forwardToken', ''),
            'forwardToLogie': config.get('forwardToLogie', False),
            'fields': config.get('fields', []),
            'transcribe': config.get('transcribe'),
            'extract': config.get('extract'),
            'analyzeAudio': config.get('analyzeAudio'),
            'extractText': config.get('extractText'),
            'forwardMedia': config.get('forwardMedia'),
            'appendValues': config.get('appendValues', []),
            'editOriginal': config.get('editOriginal', False),
            'geocode': config.get('geocode', False),
            'geocodeField': config.get('geocodeField', ''),
            'geocodeAddressFields': config.get('geocodeAddressFields', []),
            'emailNotification': config.get('emailNotification'),
            'validateSubmission': config.get('validateSubmission'),
            'failureNotification': config.get('failureNotification'),
            'forwardCondition': config.get('forwardCondition'),
            'geocodeCondition': config.get('geocodeCondition'),
        })

    # POST — validate and save
    data = request.data

    def _req(key):
        return data[key] if key in data else _MISSING

    forward_url = (data.get('forwardUrl') or '').strip()
    if forward_url:
        from urllib.parse import urlparse
        try:
            if urlparse(forward_url).scheme != 'https':
                return Response({'error': 'forwardUrl must use https://'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({'error': 'forwardUrl is not a valid URL'}, status=status.HTTP_400_BAD_REQUEST)

    def _safe_prompts(raw_prompts):
        safe = {}
        if not isinstance(raw_prompts, dict):
            return safe
        for xpath, stored in raw_prompts.items():
            if not isinstance(xpath, str) or not xpath.strip() or not isinstance(stored, dict):
                continue
            description = (stored.get('description') or '').strip() or None
            safe_fields = [{'key': str(f.get('key', '')).strip(), 'instruction': str(f.get('instruction', '')).strip()} for f in (stored.get('fields') or []) if isinstance(f, dict) and str(f.get('key', '')).strip()]
            if description or safe_fields:
                entry: dict = {'fields': safe_fields}
                if description:
                    entry['description'] = description
                safe[xpath.strip()] = entry
        return safe

    def _safe_enrich(raw, name):
        if raw is None:
            return None, None
        if raw is _MISSING:
            return _MISSING, None
        if not isinstance(raw, dict):
            return None, f'{name} must be an object'
        questions = raw.get('questions')
        if not isinstance(questions, list):
            return None, f'{name}.questions must be an array'
        result: dict = {'questions': [str(q).strip() for q in questions if str(q).strip()]}
        for opt_key in ('model', 'prompt', 'translateTo'):
            if raw.get(opt_key):
                result[opt_key] = str(raw[opt_key]).strip()
        prompts = _safe_prompts(raw.get('prompts'))
        if prompts:
            result['prompts'] = prompts
        return result, None

    safe_transcribe, err = _safe_enrich(_req('transcribe'), 'transcribe')
    if err: return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
    safe_extract, err = _safe_enrich(_req('extract'), 'extract')
    if err: return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
    safe_analyze_audio, err = _safe_enrich(_req('analyzeAudio'), 'analyzeAudio')
    if err: return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
    safe_extract_text, err = _safe_enrich(_req('extractText'), 'extractText')
    if err: return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

    ALLOWED_MEDIA = {'image', 'audio', 'video', 'application'}
    raw_fwd_media = _req('forwardMedia')
    if raw_fwd_media is None:
        safe_fwd_media = None
    elif raw_fwd_media is _MISSING:
        safe_fwd_media = _MISSING
    else:
        safe_fwd_media = [m for m in (raw_fwd_media if isinstance(raw_fwd_media, list) else []) if str(m).strip() in ALLOWED_MEDIA] or None

    safe_fields = [str(f).strip() for f in (data.get('fields') or []) if str(f).strip()]

    raw_append = _req('appendValues')
    if raw_append is None:
        safe_append: object = None
    elif raw_append is _MISSING:
        safe_append = _MISSING
    else:
        if not isinstance(raw_append, list):
            return Response({'error': 'appendValues must be an array'}, status=status.HTTP_400_BAD_REQUEST)
        safe_append = [{'key': str(e['key']).strip(), 'value': str(e['value']).strip()} for e in raw_append if isinstance(e, dict) and str(e.get('key', '')).strip()]

    # Email notification
    raw_email = _req('emailNotification')
    if raw_email is None:
        safe_email: object = None
    elif raw_email is _MISSING:
        safe_email = _MISSING
    else:
        if not isinstance(raw_email, dict):
            return Response({'error': 'emailNotification must be an object'}, status=status.HTTP_400_BAD_REQUEST)
        safe_to = [str(e).strip() for e in (raw_email.get('to') or []) if str(e).strip()]
        safe_to_xpaths = [str(x).strip() for x in (raw_email.get('toXPaths') or []) if str(x).strip()]
        if not safe_to and not safe_to_xpaths:
            return Response({'error': 'emailNotification requires at least one To email or To XPath'}, status=status.HTTP_400_BAD_REQUEST)
        safe_subj = (raw_email.get('subject') or '').strip()
        if not safe_subj:
            return Response({'error': 'emailNotification.subject is required'}, status=status.HTTP_400_BAD_REQUEST)
        safe_cc = [str(e).strip() for e in (raw_email.get('cc') or []) if str(e).strip()] or None
        safe_bcc = [str(e).strip() for e in (raw_email.get('bcc') or []) if str(e).strip()] or None
        safe_cc_xpaths = [str(x).strip() for x in (raw_email.get('ccXPaths') or []) if str(x).strip()] or None
        safe_bcc_xpaths = [str(x).strip() for x in (raw_email.get('bccXPaths') or []) if str(x).strip()] or None
        ai_body_raw = raw_email.get('aiBody')
        safe_ai_body = None
        if isinstance(ai_body_raw, dict):
            inst = (ai_body_raw.get('instructions') or '').strip()
            if inst:
                safe_ai_body = {'instructions': inst}
        safe_attachments = [str(x).strip() for x in (raw_email.get('attachments') or []) if str(x).strip()] or None
        email_cond = raw_email.get('condition')
        safe_email = {
            'to': safe_to, 'subject': safe_subj,
            **({'toXPaths': safe_to_xpaths} if safe_to_xpaths else {}),
            **({'cc': safe_cc} if safe_cc else {}),
            **({'ccXPaths': safe_cc_xpaths} if safe_cc_xpaths else {}),
            **({'bcc': safe_bcc} if safe_bcc else {}),
            **({'bccXPaths': safe_bcc_xpaths} if safe_bcc_xpaths else {}),
            **({'aiBody': safe_ai_body} if safe_ai_body else {'body': (raw_email.get('body') or '').strip()}),
            **({'attachments': safe_attachments} if safe_attachments else {}),
            **({'condition': email_cond} if _is_valid_condition(email_cond) else {}),
        }
        pdf_r = raw_email.get('pdfReport')
        if isinstance(pdf_r, dict):
            safe_email['pdfReport'] = {
                **({'template': str(pdf_r['template']).strip()} if pdf_r.get('template') else {}),
                **({'formTitle': str(pdf_r['formTitle']).strip()} if pdf_r.get('formTitle') else {}),
            }

    # Validate submission
    raw_validate = _req('validateSubmission')
    if raw_validate is None:
        safe_validate: object = None
    elif raw_validate is _MISSING:
        safe_validate = _MISSING
    else:
        val_cond = (raw_validate or {}).get('condition') if isinstance(raw_validate, dict) else None
        safe_validate = {
            'instructions': ((raw_validate or {}).get('instructions') or '').strip(),
            'includeReasoning': (raw_validate or {}).get('includeReasoning', True) is not False,
            'options': {
                'approved': (((raw_validate or {}).get('options') or {}).get('approved') or '').strip(),
                'notApproved': (((raw_validate or {}).get('options') or {}).get('notApproved') or '').strip(),
                'onHold': (((raw_validate or {}).get('options') or {}).get('onHold') or '').strip(),
            },
            **({'condition': val_cond} if _is_valid_condition(val_cond) else {}),
        }

    # Failure notification
    raw_failure = _req('failureNotification')
    if raw_failure is None:
        safe_failure: object = None
    elif raw_failure is _MISSING:
        safe_failure = _MISSING
    else:
        f_to = [str(e).strip() for e in (raw_failure.get('to') or []) if str(e).strip()]
        if not f_to:
            return Response({'error': 'failureNotification requires at least one To email'}, status=status.HTTP_400_BAD_REQUEST)
        f_subj = (raw_failure.get('subject') or '').strip()
        if not f_subj:
            return Response({'error': 'failureNotification.subject is required'}, status=status.HTTP_400_BAD_REQUEST)
        safe_failure = {
            'to': f_to, 'subject': f_subj, 'body': (raw_failure.get('body') or '').strip(),
            **({'cc': [str(e).strip() for e in raw_failure['cc'] if str(e).strip()]} if raw_failure.get('cc') else {}),
            **({'bcc': [str(e).strip() for e in raw_failure['bcc'] if str(e).strip()]} if raw_failure.get('bcc') else {}),
        }

    raw_fwd_cond = _req('forwardCondition')
    raw_geo_cond = _req('geocodeCondition')

    # Build and persist
    existing = _get_config(uid)
    next_config: dict = {
        **existing,
        'forwardUrl': forward_url,
        'forwardToken': (data.get('forwardToken') or '').strip(),
        'forwardToLogie': data.get('forwardToLogie') is True,
        'fields': safe_fields,
        'editOriginal': data.get('editOriginal') is True,
        'geocode': data.get('geocode') is True,
    }

    gf = (data.get('geocodeField') or '').strip()
    if gf:
        next_config['geocodeField'] = gf
    else:
        next_config.pop('geocodeField', None)

    gaf = [str(f).strip() for f in (data.get('geocodeAddressFields') or []) if str(f).strip()]
    if gaf:
        next_config['geocodeAddressFields'] = gaf
    else:
        next_config.pop('geocodeAddressFields', None)

    for key, safe_val, raw_val in [
        ('transcribe', safe_transcribe, _req('transcribe')),
        ('extract', safe_extract, _req('extract')),
        ('analyzeAudio', safe_analyze_audio, _req('analyzeAudio')),
        ('extractText', safe_extract_text, _req('extractText')),
        ('emailNotification', safe_email, raw_email),
        ('validateSubmission', safe_validate, raw_validate),
        ('failureNotification', safe_failure, raw_failure),
    ]:
        if raw_val is None:
            next_config.pop(key, None)
        elif safe_val is not _MISSING and safe_val is not None:
            next_config[key] = safe_val

    if raw_fwd_media is None:
        next_config.pop('forwardMedia', None)
    elif safe_fwd_media is not _MISSING and safe_fwd_media is not None:
        next_config['forwardMedia'] = safe_fwd_media

    if raw_append is None:
        next_config.pop('appendValues', None)
    elif safe_append is not _MISSING:
        if safe_append:
            next_config['appendValues'] = safe_append
        else:
            next_config.pop('appendValues', None)

    if raw_fwd_cond is None:
        next_config.pop('forwardCondition', None)
    elif raw_fwd_cond is not _MISSING and _is_valid_condition(raw_fwd_cond):
        next_config['forwardCondition'] = raw_fwd_cond

    if raw_geo_cond is None:
        next_config.pop('geocodeCondition', None)
    elif raw_geo_cond is not _MISSING and _is_valid_condition(raw_geo_cond):
        next_config['geocodeCondition'] = raw_geo_cond

    _save_config(uid, next_config)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def configure_survey(request, uid):
    config = _get_config(uid)
    server = config.get('server', '')
    if server not in ALLOWED_SERVERS:
        server = settings.DEFAULT_KOBO_BASE_URL

    token = resolve_kobo_edit_token(server, {'global': settings.KOBO_API_TOKEN_GLOBAL, 'eu': settings.KOBO_API_TOKEN_EU})

    try:
        resp = httpx.get(f'{server}/api/v2/assets/{uid}/', headers={'Authorization': f'Token {token}'}, timeout=15)
        if not resp.is_success:
            from django.http import HttpResponse
            return HttpResponse(resp.content, status=resp.status_code, content_type=resp.headers.get('content-type', 'application/json'))

        SKIP = {'begin_group', 'end_group', 'begin_repeat', 'end_repeat'}
        questions = [
            {'xpath': q.get('$xpath', ''), 'label': (q.get('label') or [q.get('$xpath', '')])[0], 'type': q.get('type', '')}
            for q in (resp.json().get('content', {}).get('survey') or [])
            if q.get('$xpath') and q.get('type') not in SKIP
        ]
        return Response({'questions': questions})
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(['POST'])
@permission_classes([AllowAny])
def configure_condition_generate(request):
    if not settings.OPENAI_API_KEY:
        return Response({'error': 'AI not configured'}, status=status.HTTP_501_NOT_IMPLEMENTED)

    prompt = (request.data.get('prompt') or '').strip()
    if not prompt:
        return Response({'error': 'prompt is required'}, status=status.HTTP_400_BAD_REQUEST)

    current_condition = request.data.get('currentCondition')
    system_prompt = """You are a filter-rule builder. The user describes a filter condition in plain language.
Return ONLY valid JSON matching this TypeScript type (no explanation, no markdown fences):

type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with"
              | "ends_with" | "is_empty" | "is_not_empty" | "greater_than" | "less_than"
              | "greater_than_or_equal" | "less_than_or_equal";
interface ConditionRule { type: "rule"; field: string; operator: Operator; value?: string; }
type Combinator = "and" | "or";
interface ConditionGroup { type: "group"; combinator: Combinator; rules: Array<ConditionRule | ConditionGroup>; }

Field names must be taken verbatim from the user's description."""

    user_message = (f'Current condition:\n{json.dumps(current_condition, indent=2)}\n\nUser request: {prompt}' if current_condition else prompt)

    try:
        resp = httpx.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {settings.OPENAI_API_KEY}', 'Content-Type': 'application/json'},
            json={'model': 'gpt-4o-mini', 'messages': [{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': user_message}], 'max_tokens': 1024, 'response_format': {'type': 'json_object'}},
            timeout=30,
        )
        if not resp.is_success:
            return Response({'error': 'AI request failed'}, status=status.HTTP_502_BAD_GATEWAY)
        raw = (resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip()
        if not raw:
            return Response({'error': 'AI returned no content'}, status=status.HTTP_502_BAD_GATEWAY)
        parsed = json.loads(raw)
        if not _is_valid_condition(parsed):
            return Response({'error': 'AI returned unexpected structure'}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({'condition': parsed})
    except json.JSONDecodeError:
        return Response({'error': 'AI returned invalid JSON'}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.error('[condition/generate] Error: %s', exc)
        return Response({'error': 'Internal error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ── Auth views (preserved from poc_template) ──────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    if not username or not password:
        return Response({'error': 'Username and password are required'}, status=status.HTTP_400_BAD_REQUEST)
    user = authenticate(request, username=username, password=password)
    if user is not None:
        login(request, user)
        return Response({'message': 'Login successful', 'user': {'id': user.id, 'username': user.username, 'email': user.email}})
    return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response({'message': 'Logout successful'})


@api_view(['GET'])
@permission_classes([AllowAny])
def me_view(request):
    if request.user.is_authenticated:
        return Response({'authenticated': True, 'user': {'id': request.user.id, 'username': request.user.username, 'email': request.user.email}})
    return Response({'authenticated': False, 'user': None})
