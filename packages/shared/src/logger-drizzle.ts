import { logger } from "./logger";
import { looksLikeToken, redactValue } from "./redaction";

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

// Separate regexes: column refs may be qualified (`t.password`); table refs may not.
const SENSITIVE_TABLES_RE = new RegExp(
  `(^|[\\s,"\`(])"?(${SENSITIVE_TABLES.join("|")})"?($|[\\s,."\`)])`
);
const SENSITIVE_COLUMNS_RE = new RegExp(
  `(^|[\\s,"\`(.])"?(${SENSITIVE_COLUMNS.join("|")})"?($|[\\s,="\`)])`
);

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

function redactParams(query: string, params: readonly unknown[]): unknown[] {
  const redactAll =
    sqlReferencesSensitiveTable(query) || sqlReferencesSensitiveColumn(query);
  return params.map((value) => {
    if (redactAll) {
      return redactValue(value);
    }
    if (typeof value === "string") {
      return looksLikeToken(value) ? REDACTED : value;
    }
    return value;
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

  replaceSqlPlaceholders(sqlTemplate: string, values: unknown[]) {
    const placeholderCount = (sqlTemplate.match(/\$\d+/g) || []).length;
    if (placeholderCount !== values.length) {
      return sqlTemplate;
    }

    return sqlTemplate.replace(/\$(\d+)/g, (_match, index) => {
      const value = values[Number.parseInt(index, 10) - 1];
      if (value === null || value === undefined) {
        return "NULL";
      }
      if (typeof value === "string") {
        return `'${value.replace(/'/g, "''")}'`;
      }
      if (typeof value === "number") {
        return value.toString();
      }
      if (typeof value === "boolean") {
        return value ? "true" : "false";
      }
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    });
  }
}
