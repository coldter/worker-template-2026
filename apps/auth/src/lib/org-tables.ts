import { logger } from "@repo/shared/logger";

// PG SQLSTATE 42P01 = undefined_table.
const PG_UNDEFINED_TABLE = "42P01";

export function isUndefinedTableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  // boundary: pg DatabaseError exposes `code` at runtime but not on the Error type.
  const code = (err as Error & { code?: unknown }).code;
  return typeof code === "string" && code === PG_UNDEFINED_TABLE;
}

export async function tolerateMissingOrgTables<T>(
  op: () => Promise<T>,
  ctx: { reason: string; meta?: Record<string, unknown> }
): Promise<T | undefined> {
  try {
    return await op();
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      throw err;
    }
    logger.warn(ctx.reason, ctx.meta);
    return;
  }
}
