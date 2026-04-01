import { logger } from "./logger";

export interface DrizzleOrmLogger {
  logQuery: (query: string, params: unknown[]) => void;
}

export class DrizzleLogger implements DrizzleOrmLogger {
  logQuery(query: string, params: unknown[]): void {
    logger.debug("DB Query", {
      query: this.replaceSqlPlaceholders(query, params),
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
