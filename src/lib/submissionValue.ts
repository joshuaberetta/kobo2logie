/**
 * Reads a value from a flat or nested submission payload by key.
 * Supports dot and slash notation for nested fields (e.g. "group/question").
 */
export function getPayloadValue(payload: Record<string, unknown>, key: string): unknown {
  const trimmed = key.trim();
  if (!trimmed) return undefined;

  if (Object.prototype.hasOwnProperty.call(payload, trimmed)) {
    return payload[trimmed];
  }

  const readNested = (segments: string[]): unknown => {
    let current: unknown = payload;
    for (const seg of segments) {
      if (!seg) continue;
      if (typeof current !== "object" || current === null || Array.isArray(current)) {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(current, seg)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[seg];
    }
    return current;
  };

  if (trimmed.includes("/")) {
    const value = readNested(trimmed.split("/"));
    if (value !== undefined) return value;
  }
  if (trimmed.includes(".")) {
    const value = readNested(trimmed.split("."));
    if (value !== undefined) return value;
  }

  return undefined;
}
