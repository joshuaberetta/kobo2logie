"""
KoboToolbox attachment helpers and SSRF guard.
Port of src/lib/kobo.ts.
"""

from urllib.parse import urlparse


def is_allowed_media_host(url: str, base_url: str) -> bool:
    """Returns True if the URL's hostname matches the base_url hostname (SSRF guard)."""
    try:
        return urlparse(url).hostname == urlparse(base_url).hostname
    except Exception:
        return False


def image_attachments(submission: dict) -> list[dict]:
    return [
        a for a in (submission.get('_attachments') or [])
        if not a.get('is_deleted') and (a.get('mimetype') or '').startswith('image/')
    ]


def file_attachments(submission: dict) -> list[dict]:
    return [
        a for a in (submission.get('_attachments') or [])
        if not a.get('is_deleted') and not (a.get('mimetype') or '').startswith('image/')
    ]


def _submission_string_values(submission: dict) -> set[str]:
    names: set[str] = set()
    for key, value in submission.items():
        if key == '_attachments':
            continue
        if isinstance(value, str) and value:
            names.add(value)
    return names


def attachments_to_forward(submission: dict, reference: dict | None = None) -> list[dict]:
    """
    Returns non-deleted attachments whose media_file_basename appears as a
    string value in the reference payload (or full submission if reference is None).
    """
    scan_target = reference if reference is not None else submission
    filenames: set[str] = set()
    for key, value in scan_target.items():
        if key == '_attachments':
            continue
        if isinstance(value, str) and value:
            filenames.add(value)
    return [
        a for a in (submission.get('_attachments') or [])
        if not a.get('is_deleted') and a.get('media_file_basename') in filenames
    ]


def format_submission_time(iso: str) -> str:
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
        return dt.astimezone(timezone.utc).strftime('%d %b %Y, %H:%M')
    except Exception:
        return iso
