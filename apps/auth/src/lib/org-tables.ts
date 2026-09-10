import { logger } from "@repo/shared/logger";

const PG_UNDEFINED_TABLE = "42P01";

type UndefinedTableError = Error & { code: typeof PG_UNDEFINED_TABLE };

export function isUndefinedTableError(
  err: unknown
): err is UndefinedTableError {
  return (
    err instanceof Error && "code" in err && err.code === PG_UNDEFINED_TABLE
  );
}

export async function tolerateMissingOrgTables<T>(
  op: () => Promise<T>,
  ctx: { reason: string; meta?: Record<string, string> }
): Promise<T | undefined> {
  try {
    return await op();
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      throw err;
    }
    logger.warn(ctx.reason, ctx.meta);
  }
}
