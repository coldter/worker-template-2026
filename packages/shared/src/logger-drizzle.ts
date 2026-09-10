import { z } from "zod";
import { logger } from "./logger";
import {
  looksLikeToken,
  type RedactableValue,
  redactableValueSchema,
  redactValue,
} from "./redaction";

export interface DrizzleOrmLogger {
  logQuery: (query: string, params: unknown[]) => void;
}

const SENSITIVE_TABLES: readonly string[] = [
  "accounts",
  "verifications",
  "two_factors",
  "sessions",
  "jwks",
];

const SENSITIVE_COLUMNS: readonly string[] = [
  "password",
  "password_hash",
  "refresh_token",
  "access_token",
  "id_token",
  "value",
  "backup_codes",
  "secret",
  "salt",
  "code",
  "otp",
  "token",
  "session_token",
  "private_key",
  "api_key",
];

const REDACTED = "[REDACTED]";

const SENSITIVE_TABLES_RE = new RegExp(
  `(^|[\\s,"\`(])"?(${SENSITIVE_TABLES.join("|")})"?($|[\\s,."\`)])`
);
const SENSITIVE_COLUMNS_RE = new RegExp(
  `(^|[\\s,"\`(.])"?(${SENSITIVE_COLUMNS.join("|")})"?($|[\\s,="\`)])`
);

const stringSchema = z.string();
const numberSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
]);
const booleanSchema = z.boolean();

type SqlParam =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "json"; readonly value: RedactableValue }
  | { readonly kind: "null" }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string };

function isLogSqlEnabled(): boolean {
  if (typeof process === "undefined") {
    return false;
  }
  const flag = process.env?.LOG_SQL?.toLowerCase();
  if (flag === "false" || flag === "0") {
    return false;
  }
  if (flag === "true" || flag === "1") {
    return true;
  }
  return process.env?.NODE_ENV !== "production";
}

function sqlReferencesSensitiveTable(sql: string): boolean {
  return SENSITIVE_TABLES_RE.test(sql.toLowerCase());
}

function sqlReferencesSensitiveColumn(sql: string): boolean {
  return SENSITIVE_COLUMNS_RE.test(sql.toLowerCase());
}

function toSqlParam(value: RedactableValue, filterTokens: boolean): SqlParam {
  if (value === null || value === undefined) {
    return { kind: "null" };
  }

  const stringValue = stringSchema.safeParse(value);
  if (stringValue.success) {
    const redacted =
      filterTokens && looksLikeToken(stringValue.data)
        ? REDACTED
        : stringValue.data;
    return { kind: "string", value: redacted };
  }

  const numberValue = numberSchema.safeParse(value);
  if (numberValue.success) {
    return { kind: "number", value: numberValue.data };
  }

  const booleanValue = booleanSchema.safeParse(value);
  if (booleanValue.success) {
    return { kind: "boolean", value: booleanValue.data };
  }

  return { kind: "json", value };
}

function redactParams(query: string, params: readonly unknown[]): SqlParam[] {
  const redactAll =
    sqlReferencesSensitiveTable(query) || sqlReferencesSensitiveColumn(query);
  return params.map((value) => {
    const parsed = redactableValueSchema.safeParse(value);
    if (!parsed.success) {
      if (redactAll) {
        return { kind: "string", value: REDACTED };
      }
      try {
        return { kind: "string", value: String(value) };
      } catch {
        return { kind: "string", value: REDACTED };
      }
    }
    return redactAll
      ? toSqlParam(redactValue(parsed.data), false)
      : toSqlParam(parsed.data, true);
  });
}

export class DrizzleLogger implements DrizzleOrmLogger {
  logQuery(query: string, params: unknown[]): void {
    if (!isLogSqlEnabled()) {
      return;
    }
    const safeParams = redactParams(query, params);
    logger.debug("DB Query", {
      query: this.replaceSqlPlaceholders(query, safeParams),
    });
  }

  replaceSqlPlaceholders(sqlTemplate: string, values: SqlParam[]): string {
    const placeholderCount = (sqlTemplate.match(/\$\d+/g) || []).length;
    if (placeholderCount !== values.length) {
      return sqlTemplate;
    }

    return sqlTemplate.replace(/\$(\d+)/g, (_match, index) => {
      const value = values[Number.parseInt(index, 10) - 1];
      if (value === undefined || value.kind === "null") {
        return "NULL";
      }
      if (value.kind === "string") {
        return `'${value.value.replace(/'/g, "''")}'`;
      }
      if (value.kind === "number") {
        return value.value.toString();
      }
      if (value.kind === "boolean") {
        return value.value ? "true" : "false";
      }
      return `'${JSON.stringify(value.value).replace(/'/g, "''")}'`;
    });
  }
}
