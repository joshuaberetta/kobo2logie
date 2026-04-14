import type { Condition, ConditionGroup, ConditionRule, Operator } from "../types.js";
import { getPayloadValue } from "./submissionValue.js";

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  return parseFloat(toStr(value));
}

function applyOperator(operator: Operator, fieldValue: unknown, ruleValue: string | undefined): boolean {
  switch (operator) {
    case "is_empty":
      return isEmpty(fieldValue);
    case "is_not_empty":
      return !isEmpty(fieldValue);
  }

  const a = toStr(fieldValue).trim().toLowerCase();
  const b = (ruleValue ?? "").trim().toLowerCase();

  switch (operator) {
    case "equals":
      return a === b;
    case "not_equals":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    case "greater_than":
      return toNum(fieldValue) > toNum(ruleValue);
    case "less_than":
      return toNum(fieldValue) < toNum(ruleValue);
    case "greater_than_or_equal":
      return toNum(fieldValue) >= toNum(ruleValue);
    case "less_than_or_equal":
      return toNum(fieldValue) <= toNum(ruleValue);
    default:
      return false;
  }
}

function evaluateRule(rule: ConditionRule, submission: Record<string, unknown>): boolean {
  const fieldValue = getPayloadValue(submission, rule.field);
  return applyOperator(rule.operator, fieldValue, rule.value);
}

function evaluateGroup(group: ConditionGroup, submission: Record<string, unknown>): boolean {
  if (group.rules.length === 0) return true; // vacuous truth

  if (group.combinator === "and") {
    return group.rules.every((child) => evaluateNode(child, submission));
  } else {
    return group.rules.some((child) => evaluateNode(child, submission));
  }
}

function evaluateNode(node: ConditionRule | ConditionGroup, submission: Record<string, unknown>): boolean {
  if (node.type === "rule") return evaluateRule(node, submission);
  return evaluateGroup(node, submission);
}

/**
 * Evaluates a stored Condition against a submission payload.
 * Returns true if:
 * - condition is undefined (no filter configured → always run)
 * - the condition group has no rules (vacuous truth)
 * - all/any rules pass per the group's combinator
 */
export function evaluateCondition(
  condition: Condition | undefined,
  submission: Record<string, unknown>
): boolean {
  if (!condition) return true;
  return evaluateGroup(condition, submission);
}
