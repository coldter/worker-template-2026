const REDACTED = "[REDACTED]";
const TOKEN_LIKE = /^[A-Za-z0-9+/=_-]{24,}$|^[0-9a-fA-F]{24,}$/;
const DEFAULT_MAX_DEPTH = 5;
const NESTED_STRING_REDACT_MIN_LENGTH = 8;

export interface RedactOptions {
  maxDepth?: number;
}

export function looksLikeToken(value: string): boolean {
  return value.length >= 24 && TOKEN_LIKE.test(value);
}

export function redactNested(value: unknown, opts?: RedactOptions): unknown {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  return redactNestedInner(value, 0, maxDepth);
}

function redactNestedInner(
  value: unknown,
  depth: number,
  maxDepth: number
): unknown {
  if (depth >= maxDepth) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return value.length > NESTED_STRING_REDACT_MIN_LENGTH ? REDACTED : value;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactNestedInner(entry, depth + 1, maxDepth));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      result[key] = redactNestedInner(source[key], depth + 1, maxDepth);
    }
    return result;
  }
  return value;
}

export function redactValue(value: unknown, opts?: RedactOptions): unknown {
  if (typeof value === "string") {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return redactNested(value, opts);
}

export function buildSensitiveRefMatcher(
  names: readonly string[]
): (input: string) => boolean {
  if (names.length === 0) {
    return () => false;
  }
  const pattern = new RegExp(
    `(^|[\\s,"\`(.])"?(${names.join("|")})"?($|[\\s,.="\`)])`,
    "i"
  );
  return (input: string) => pattern.test(input);
}
