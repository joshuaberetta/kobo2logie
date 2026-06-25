"""
Evaluates a stored condition JSON against a submission payload.
Direct port of src/lib/evaluateCondition.ts.
"""

from typing import Any

from .submission_value import get_payload_value


def _is_empty(value: Any) -> bool:
    if value is None or value == '':
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


def _to_str(value: Any) -> str:
    if value is None:
        return ''
    return str(value)


def _to_num(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(_to_str(value))
    except (ValueError, TypeError):
        return float('nan')


def _apply_operator(operator: str, field_value: Any, rule_value: str | None) -> bool:
    if operator == 'is_empty':
        return _is_empty(field_value)
    if operator == 'is_not_empty':
        return not _is_empty(field_value)

    a = _to_str(field_value).strip().lower()
    b = (rule_value or '').strip().lower()

    if operator == 'equals':
        return a == b
    if operator == 'not_equals':
        return a != b
    if operator == 'contains':
        return b in a
    if operator == 'not_contains':
        return b not in a
    if operator == 'starts_with':
        return a.startswith(b)
    if operator == 'ends_with':
        return a.endswith(b)
    if operator == 'greater_than':
        return _to_num(field_value) > _to_num(rule_value)
    if operator == 'less_than':
        return _to_num(field_value) < _to_num(rule_value)
    if operator == 'greater_than_or_equal':
        return _to_num(field_value) >= _to_num(rule_value)
    if operator == 'less_than_or_equal':
        return _to_num(field_value) <= _to_num(rule_value)
    return False


def _evaluate_rule(rule: dict, submission: dict) -> bool:
    field_value = get_payload_value(submission, rule.get('field', ''))
    return _apply_operator(rule.get('operator', ''), field_value, rule.get('value'))


def _evaluate_group(group: dict, submission: dict) -> bool:
    rules = group.get('rules', [])
    if not rules:
        return True  # vacuous truth

    combinator = group.get('combinator', 'and')
    if combinator == 'and':
        return all(_evaluate_node(child, submission) for child in rules)
    else:
        return any(_evaluate_node(child, submission) for child in rules)


def _evaluate_node(node: dict, submission: dict) -> bool:
    if node.get('type') == 'rule':
        return _evaluate_rule(node, submission)
    return _evaluate_group(node, submission)


def evaluate_condition(condition: dict | None, submission: dict) -> bool:
    """
    Returns True if:
    - condition is None (no filter → always run)
    - the condition group has no rules (vacuous truth)
    - all/any rules pass per the combinator
    """
    if not condition:
        return True
    return _evaluate_group(condition, submission)
