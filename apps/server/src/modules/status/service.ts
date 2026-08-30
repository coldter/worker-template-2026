import type { DrizzleClient } from "@repo/db";
import { logger } from "@repo/shared/logger";
import { sql } from "drizzle-orm";

export type ReadinessChecks = {
  database: boolean;
  cache: boolean;
};

// Single get signature instead of the full KVNamespace so tests can pass a
// plain stub; a real KVNamespace remains assignable.
export type ReadinessCache = {
  get(key: string): Promise<string | null>;
};

// A hung Hyperdrive origin should flip readiness fast; uptime checks cannot
// wait out a full query timeout.
const DEFAULT_PROBE_TIMEOUT_MS = 2000;

async function withProbeTimeout<T>(
  probe: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeDatabase(
  db: DrizzleClient,
  timeoutMs: number
): Promise<boolean> {
  try {
    await withProbeTimeout(db.execute(sql`SELECT 1`), timeoutMs);
    return true;
  } catch (error) {
    logger.warn("readiness: database probe failed", {
      error,
    });
    return false;
  }
}

async function probeCache(
  cache: ReadinessCache,
  timeoutMs: number
): Promise<boolean> {
  try {
    // A get on a missing key is still a full KV round-trip.
    await withProbeTimeout(cache.get("readiness-probe"), timeoutMs);
    return true;
  } catch (error) {
    logger.warn("readiness: cache probe failed", {
      error,
    });
    return false;
  }
}

export async function checkReadiness(
  db: DrizzleClient,
  cache: ReadinessCache,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
): Promise<ReadinessChecks> {
  const [database, cacheOk] = await Promise.all([
    probeDatabase(db, timeoutMs),
    probeCache(cache, timeoutMs),
  ]);
  return { cache: cacheOk, database };
}
