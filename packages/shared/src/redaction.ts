import { z } from "zod";

const REDACTED = "[REDACTED]";
const TOKEN_LIKE = /^[A-Za-z0-9+/=_-]{24,}$|^[0-9a-fA-F]{24,}$/;
const DEFAULT_MAX_DEPTH = 5;
const NESTED_STRING_REDACT_MIN_LENGTH = 8;

export interface RedactOptions {
  maxDepth?: number;
}

export type RedactableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array
  | RedactableValue[]
  | { [key: string]: RedactableValue };

const stringSchema = z.string();
const numberSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
]);
const booleanSchema = z.boolean();
const primitiveSchema = z.union([numberSchema, booleanSchema]);
const dateSchema = z.date();
const bytesSchema = z.instanceof(Uint8Array);
const arraySchema = z.array(z.lazy(() => redactableValueSchema));
const recordSchema = z.record(
  z.string(),
  z.lazy(() => redactableValueSchema)
);

export const redactableValueSchema: z.ZodType<RedactableValue> = z.lazy(() =>
  z.union([
    stringSchema,
    numberSchema,
    booleanSchema,
    z.null(),
    z.undefined(),
    dateSchema,
    bytesSchema,
    arraySchema,
    recordSchema,
  ])
);

export function looksLikeToken(value: string): boolean {
  return value.length >= 24 && TOKEN_LIKE.test(value);
}

export function redactNested(
  value: RedactableValue,
  opts?: RedactOptions
): RedactableValue {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  return redactNestedInner(value, 0, maxDepth);
}

function redactNestedInner(
  value: RedactableValue,
  depth: number,
  maxDepth: number
): RedactableValue {
  if (depth >= maxDepth) {
    return REDACTED;
  }

  const stringValue = stringSchema.safeParse(value);
  if (stringValue.success) {
    return stringValue.data.length > NESTED_STRING_REDACT_MIN_LENGTH
      ? REDACTED
      : stringValue.data;
  }

  if (value === null || value === undefined) {
    return value;
  }

  const primitive = primitiveSchema.safeParse(value);
  if (primitive.success) {
    return primitive.data;
  }

  if (value instanceof Date) {
    return {};
  }

  const bytes = bytesSchema.safeParse(value);
  if (bytes.success) {
    const result: { [key: string]: RedactableValue } = {};
    bytes.data.forEach((byte, index) => {
      result[index] = redactNestedInner(byte, depth + 1, maxDepth);
    });
    return result;
  }

  const arrayValue = arraySchema.safeParse(value);
  if (arrayValue.success) {
    return arrayValue.data.map((entry) =>
      redactNestedInner(entry, depth + 1, maxDepth)
    );
  }

  const recordValue = recordSchema.safeParse(value);
  if (recordValue.success) {
    const result: { [key: string]: RedactableValue } = {};
    for (const [key, entry] of Object.entries(recordValue.data)) {
      result[key] = redactNestedInner(entry, depth + 1, maxDepth);
    }
    return result;
  }

  return REDACTED;
}

export function redactValue(
  value: RedactableValue,
  opts?: RedactOptions
): RedactableValue {
  const stringValue = stringSchema.safeParse(value);
  if (stringValue.success) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  const primitive = primitiveSchema.safeParse(value);
  if (primitive.success) {
    return primitive.data;
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
