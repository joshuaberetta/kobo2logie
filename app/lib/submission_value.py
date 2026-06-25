"""
Read a value from a flat or nested submission payload by key.
Supports dot and slash notation for nested fields (e.g. "group/question").
"""

from typing import Any


def get_payload_value(payload: dict, key: str) -> Any:
    trimmed = key.strip()
    if not trimmed:
        return None

    if trimmed in payload:
        return payload[trimmed]

    def read_nested(segments: list[str]) -> Any:
        current: Any = payload
        for seg in segments:
            if not seg:
                continue
            if not isinstance(current, dict):
                return None
            if seg not in current:
                return None
            current = current[seg]
        return current

    if '/' in trimmed:
        value = read_nested(trimmed.split('/'))
        if value is not None:
            return value

    if '.' in trimmed:
        value = read_nested(trimmed.split('.'))
        if value is not None:
            return value

    return None
