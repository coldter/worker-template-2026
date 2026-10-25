import { logger } from "@repo/shared/logger";

const PG_UNDEFINED_TABLE = "42P01";

type UndefinedTableError = Error & { code: typeof PG_UNDEFINED_TABLE };

export const isUndefinedTableError = (
  err: unknown
): err is UndefinedTableError =>
  err instanceof Error && "code" in err && err.code === PG_UNDEFINED_TABLE;

export const tolerateMissingOrgTables = async <T>(
  op: () => Promise<T>,
  ctx: { reason: string; meta?: Record<string, string> }
): Promise<T | undefined> => {
  try {
    return await op();
  } catch (error) {
    if (!isUndefinedTableError(error)) {
      throw error;
    }

    logger.warn(ctx.reason, ctx.meta);
  }
};
