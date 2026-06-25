"""
Core enrichment + forwarding pipeline.
Port of src/lib/forward.ts.
"""

import logging

import httpx

from .kobo import attachments_to_forward
from .transcribe import transcribe_audio
from .extract import extract_fields
from .analyze_audio import analyze_audio_text
from .extract_text import extract_text_fields

logger = logging.getLogger(__name__)

EU_HOSTNAME = 'eu.kobotoolbox.org'


def _resolve_kobo_token(kobo_base_url: str, tokens: dict[str, str]) -> str:
    try:
        from urllib.parse import urlparse
        host = urlparse(kobo_base_url).hostname or ''
        return tokens['eu'] if host == EU_HOSTNAME else tokens['global']
    except Exception:
        return tokens['global']


def _build_prompt_from_fields(stored: dict) -> str:
    parts = []
    if stored.get('description', '').strip():
        parts.append(stored['description'].strip())
    lines = [
        f'- {f["key"]}: {f["instruction"]}' if f.get('instruction', '').strip() else f'- {f["key"]}'
        for f in stored.get('fields', [])
        if f.get('key', '').strip()
    ]
    if lines:
        parts.append(
            'Extract the following fields and return them as a JSON object with exactly these keys:\n' + '\n'.join(lines)
        )
    return '\n\n'.join(parts)


def forward_submission(
    submission: dict,
    forward_url: str | None,
    kobo_base_url: str,
    tokens: dict[str, str],
    json_payload: dict | None = None,
    forward_token: str | None = None,
    transcribe_config: dict | None = None,
    openai_api_key: str | None = None,
    forward_media: list[str] | None = None,
    extract_config: dict | None = None,
    analyze_audio_config: dict | None = None,
    extract_text_config: dict | None = None,
    logie_api_key: str | None = None,
) -> dict:
    """
    Runs enrichment (transcription, image extraction, audio analysis, text extraction)
    then optionally POSTs to forward_url as multipart/form-data.

    Returns a dict matching the ForwardResult shape from the TS code:
    {ok, http_status?, response_body?, error?, enrichment?, steps?}
    """
    try:
        token = _resolve_kobo_token(kobo_base_url, tokens)
        enrichment: dict[str, str] = {}
        steps: dict[str, dict] = {}

        payload: dict = dict(json_payload) if json_payload else dict(submission)

        # ── Transcription ──────────────────────────────────────────────────
        if transcribe_config and openai_api_key and transcribe_config.get('questions'):
            steps['transcribe'] = {}
            audio_by_xpath = {
                a['question_xpath']: a
                for a in (submission.get('_attachments') or [])
                if not a.get('is_deleted') and (a.get('mimetype') or '').startswith('audio/')
            }

            for question_name in transcribe_config['questions']:
                att = audio_by_xpath.get(question_name)
                if not att:
                    logger.warning('[transcribe] No audio attachment found for "%s"', question_name)
                    steps['transcribe'][question_name] = {'ok': False, 'error': 'No audio attachment found'}
                    continue
                try:
                    resp = httpx.get(
                        att['download_url'],
                        headers={'Authorization': f'Token {token}'},
                        timeout=30,
                    )
                    if not resp.is_success:
                        logger.error('[transcribe] Failed to fetch audio for "%s": HTTP %s', question_name, resp.status_code)
                        steps['transcribe'][question_name] = {'ok': False, 'error': f'Failed to fetch audio: HTTP {resp.status_code}'}
                        continue
                    transcript = transcribe_audio(
                        resp.content,
                        att['media_file_basename'],
                        openai_api_key,
                        transcribe_config.get('model', 'gpt-4o-mini-transcribe'),
                        transcribe_config.get('prompt'),
                    )
                    if transcript:
                        # Optional translation
                        final_text = transcript
                        translate_to = transcribe_config.get('translateTo')
                        if translate_to:
                            try:
                                tl_resp = httpx.post(
                                    'https://api.openai.com/v1/chat/completions',
                                    headers={'Authorization': f'Bearer {openai_api_key}', 'Content-Type': 'application/json'},
                                    json={
                                        'model': 'gpt-4o-mini',
                                        'messages': [
                                            {'role': 'system', 'content': f'Translate the following text to {translate_to}. Return only the translated text, no explanation.'},
                                            {'role': 'user', 'content': transcript},
                                        ],
                                        'max_tokens': 1024,
                                    },
                                    timeout=30,
                                )
                                if tl_resp.is_success:
                                    final_text = (tl_resp.json().get('choices') or [{}])[0].get('message', {}).get('content', '').strip() or transcript
                                else:
                                    logger.error('[transcribe] Translation failed for "%s": HTTP %s', question_name, tl_resp.status_code)
                            except Exception as exc:
                                logger.error('[transcribe] Translation error for "%s": %s', question_name, exc)

                        transcript_key = f'{question_name}_transcript'
                        payload[transcript_key] = final_text
                        enrichment[transcript_key] = final_text
                        steps['transcribe'][question_name] = {'ok': True, 'keys': [transcript_key]}
                    else:
                        steps['transcribe'][question_name] = {'ok': False, 'error': 'No transcript returned'}
                except Exception as exc:
                    logger.error('[transcribe] Error transcribing "%s": %s', question_name, exc)
                    steps['transcribe'][question_name] = {'ok': False, 'error': str(exc)}

        # ── Audio analysis ─────────────────────────────────────────────────
        if analyze_audio_config and openai_api_key and analyze_audio_config.get('questions'):
            steps['analyzeAudio'] = {}
            audio_by_xpath_analysis = {
                a['question_xpath']: a
                for a in (submission.get('_attachments') or [])
                if not a.get('is_deleted') and (a.get('mimetype') or '').startswith('audio/')
            }

            for question_name in analyze_audio_config['questions']:
                try:
                    transcript = payload.get(f'{question_name}_transcript')
                    if not transcript:
                        att = audio_by_xpath_analysis.get(question_name)
                        if not att:
                            logger.warning('[analyze-audio] No audio attachment for "%s"', question_name)
                            steps['analyzeAudio'][question_name] = {'ok': False, 'error': 'No audio attachment found'}
                            continue
                        resp = httpx.get(
                            att['download_url'],
                            headers={'Authorization': f'Token {token}'},
                            timeout=30,
                        )
                        if not resp.is_success:
                            logger.error('[analyze-audio] Failed to fetch audio for "%s": HTTP %s', question_name, resp.status_code)
                            steps['analyzeAudio'][question_name] = {'ok': False, 'error': f'Failed to fetch audio: HTTP {resp.status_code}'}
                            continue
                        transcript = transcribe_audio(resp.content, att['media_file_basename'], openai_api_key) or None

                    if not transcript:
                        steps['analyzeAudio'][question_name] = {'ok': False, 'error': 'No transcript available for analysis'}
                        continue

                    prompt_entry = (analyze_audio_config.get('prompts') or {}).get(question_name)
                    custom_prompt = _build_prompt_from_fields(prompt_entry) if prompt_entry and (prompt_entry.get('description') or prompt_entry.get('fields')) else None

                    analyzed = analyze_audio_text(
                        transcript,
                        openai_api_key,
                        analyze_audio_config.get('model', 'gpt-4o-mini'),
                        custom_prompt or 'Analyze this transcript. Return a flat JSON object with string values only.',
                    )
                    if analyzed:
                        written_keys = []
                        for k, v in analyzed.items():
                            if k != '_uuid':
                                payload[k] = v
                                enrichment[k] = v
                                written_keys.append(k)
                        steps['analyzeAudio'][question_name] = {'ok': True, 'keys': written_keys}
                    else:
                        steps['analyzeAudio'][question_name] = {'ok': False, 'error': 'No analysis returned'}
                except Exception as exc:
                    logger.error('[analyze-audio] Error analyzing "%s": %s', question_name, exc)
                    steps['analyzeAudio'][question_name] = {'ok': False, 'error': str(exc)}

        # ── Image field extraction ─────────────────────────────────────────
        if extract_config and openai_api_key and extract_config.get('questions'):
            steps['extract'] = {}
            image_by_xpath = {
                a['question_xpath']: a
                for a in (submission.get('_attachments') or [])
                if not a.get('is_deleted') and (a.get('mimetype') or '').startswith('image/')
            }

            for question_name in extract_config['questions']:
                att = image_by_xpath.get(question_name)
                if not att:
                    logger.warning('[extract] No image attachment for "%s"', question_name)
                    steps['extract'][question_name] = {'ok': False, 'error': 'No image attachment found'}
                    continue
                try:
                    resp = httpx.get(
                        att['download_url'],
                        headers={'Authorization': f'Token {token}'},
                        timeout=30,
                    )
                    if not resp.is_success:
                        logger.error('[extract] Failed to fetch image for "%s": HTTP %s', question_name, resp.status_code)
                        steps['extract'][question_name] = {'ok': False, 'error': f'Failed to fetch image: HTTP {resp.status_code}'}
                        continue
                    prompt_entry = (extract_config.get('prompts') or {}).get(question_name)
                    custom_prompt = _build_prompt_from_fields(prompt_entry) if prompt_entry and (prompt_entry.get('description') or prompt_entry.get('fields')) else None

                    extracted = extract_fields(
                        resp.content,
                        att['media_file_basename'],
                        openai_api_key,
                        extract_config.get('model', 'gpt-4o-mini'),
                        custom_prompt or 'Extract structured data from this image. Return a flat JSON object with string values only.',
                    )
                    if extracted:
                        written_keys = []
                        for k, v in extracted.items():
                            if k != '_uuid':
                                payload[k] = v
                                enrichment[k] = v
                                written_keys.append(k)
                        steps['extract'][question_name] = {'ok': True, 'keys': written_keys}
                    else:
                        steps['extract'][question_name] = {'ok': False, 'error': 'No fields extracted'}
                except Exception as exc:
                    logger.error('[extract] Error extracting from "%s": %s', question_name, exc)
                    steps['extract'][question_name] = {'ok': False, 'error': str(exc)}

        # ── Text field extraction ──────────────────────────────────────────
        if extract_text_config and openai_api_key and extract_text_config.get('questions'):
            steps['extractText'] = {}
            for question_name in extract_text_config['questions']:
                try:
                    text = submission.get(question_name)
                    if not isinstance(text, str) or not text.strip():
                        steps['extractText'][question_name] = {'ok': False, 'error': 'No text value found for question'}
                        continue
                    prompt_entry = (extract_text_config.get('prompts') or {}).get(question_name)
                    custom_prompt = _build_prompt_from_fields(prompt_entry) if prompt_entry and (prompt_entry.get('description') or prompt_entry.get('fields')) else None

                    extracted = extract_text_fields(
                        text,
                        openai_api_key,
                        extract_text_config.get('model', 'gpt-4o-mini'),
                        custom_prompt or 'Extract named entities and key facts. Return a flat JSON object with string values only.',
                    )
                    if extracted:
                        written_keys = []
                        for k, v in extracted.items():
                            if k != '_uuid':
                                payload[k] = v
                                enrichment[k] = v
                                written_keys.append(k)
                        steps['extractText'][question_name] = {'ok': True, 'keys': written_keys}
                    else:
                        steps['extractText'][question_name] = {'ok': False, 'error': 'No fields extracted'}
                except Exception as exc:
                    logger.error('[extract-text] Error extracting from "%s": %s', question_name, exc)
                    steps['extractText'][question_name] = {'ok': False, 'error': str(exc)}

        steps_result = steps if steps else None

        if not forward_url:
            return {'ok': True, 'enrichment': enrichment, 'steps': steps_result}

        # ── Attachment fetch & multipart forward ───────────────────────────
        attachments = attachments_to_forward(submission, json_payload)
        if forward_media:
            attachments = [
                a for a in attachments
                if any((a.get('mimetype') or '').startswith(prefix + '/') for prefix in forward_media)
            ]

        import json as json_module
        files = [('submission', (None, json_module.dumps(payload), 'application/json'))]
        for att in attachments:
            try:
                resp = httpx.get(
                    att['download_url'],
                    headers={'Authorization': f'Token {token}'},
                    timeout=30,
                )
                if resp.is_success:
                    files.append((att['media_file_basename'], (att['media_file_basename'], resp.content, att.get('mimetype', 'application/octet-stream'))))
                else:
                    logger.error('[forward] Failed to fetch attachment %s: HTTP %s', att['media_file_basename'], resp.status_code)
            except Exception as exc:
                logger.error('[forward] Error fetching attachment %s: %s', att['media_file_basename'], exc)

        fwd_headers: dict[str, str] = {}
        if logie_api_key:
            fwd_headers['x-api-key'] = logie_api_key
        elif forward_token:
            fwd_headers['Authorization'] = f'Bearer {forward_token}'

        fwd_resp = httpx.post(forward_url, headers=fwd_headers, files=files, timeout=60)
        response_body = fwd_resp.text[:2048] if fwd_resp.text else None

        if not fwd_resp.is_success:
            logger.error('[forward] External service returned HTTP %s for %s', fwd_resp.status_code, forward_url)
            return {'ok': False, 'http_status': fwd_resp.status_code, 'response_body': response_body, 'enrichment': enrichment, 'steps': steps_result}

        return {'ok': True, 'http_status': fwd_resp.status_code, 'response_body': response_body, 'enrichment': enrichment, 'steps': steps_result}

    except Exception as exc:
        logger.error('[forward] Unhandled error in forward_submission: %s', exc)
        return {'ok': False, 'error': str(exc)}
