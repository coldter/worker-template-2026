import type { DrizzleClient } from "@repo/db";
import { logger } from "@repo/shared/logger";
import { sql } from "drizzle-orm";

export interface ReadinessChecks {
  database: boolean;
  cache: boolean;
}

export interface ReadinessCache {
  get: (key: string) => Promise<string | null>;
}

const DEFAULT_PROBE_TIMEOUT_MS = 2000;

const withProbeTimeout = async <T>(
  probe: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      probe,
      // oxlint-disable-next-line promise/avoid-new -- timeout rejection has no ES2022 alternative that clears the timer
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const probeDatabase = async (
  db: DrizzleClient,
  timeoutMs: number
): Promise<boolean> => {
  try {
    await withProbeTimeout(db.execute(sql`SELECT 1`), timeoutMs);

    return true;
  } catch (error) {
    logger.warn("readiness: database probe failed", {
      error,
    });

    return false;
  }
};

const probeCache = async (
  cache: ReadinessCache,
  timeoutMs: number
): Promise<boolean> => {
  try {
    await withProbeTimeout(cache.get("readiness-probe"), timeoutMs);

    return true;
  } catch (error) {
    logger.warn("readiness: cache probe failed", {
      error,
    });

    return false;
  }
};

export const checkReadiness = async (
  db: DrizzleClient,
  cache: ReadinessCache,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
): Promise<ReadinessChecks> => {
  const [database, cacheOk] = await Promise.all([
    probeDatabase(db, timeoutMs),
    probeCache(cache, timeoutMs),
  ]);

  return { cache: cacheOk, database };
};
