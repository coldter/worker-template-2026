import type { DrizzleClient, Executor } from "@repo/db";
import { tenantCustomHostnames } from "@repo/db/schema";
import { and, count, eq, gte, inArray } from "drizzle-orm";

export type TenancyRateLimitReason = "pending_quota" | "daily_quota";

export class TenancyRateLimitError extends Error {
  readonly reason: TenancyRateLimitReason;
  readonly retryAfterSeconds: number;
  constructor(reason: TenancyRateLimitReason, retryAfterSeconds: number) {
    super(`tenancy rate limit hit: ${reason}`);
    this.name = "TenancyRateLimitError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const PENDING_LIMIT = 10;
export const DAILY_LIMIT = 50;
export const NON_TERMINAL_LIFECYCLE = [
  "pending_txt",
  "awaiting_cf",
  "pre_validation",
] as const;

/**
 * Reject when the org already has 10 in-flight (non-terminal, non-failed,
 * non-removed) custom hostname rows. `failed` is excluded so the tenant can
 * retry after fixing CAA / DNS issues.
 */
export async function assertWithinPendingLimit(
  db: DrizzleClient | Executor,
  organizationId: string
): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(tenantCustomHostnames)
    .where(
      and(
        eq(tenantCustomHostnames.organizationId, organizationId),
        inArray(tenantCustomHostnames.lifecycleStatus, [
          ...NON_TERMINAL_LIFECYCLE,
        ])
      )
    );
  const n = row?.n ?? 0;
  if (n >= PENDING_LIMIT) {
    throw new TenancyRateLimitError("pending_quota", 86_400);
  }
}

/**
 * Reject when the org has created more than 50 hostname rows in the last
 * 24h, regardless of their current lifecycle. This protects CF reputation
 * from quota burn even if the tenant is rapidly tombstoning rows.
 */
export async function assertWithinDailyLimit(
  db: DrizzleClient | Executor,
  organizationId: string
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: count() })
    .from(tenantCustomHostnames)
    .where(
      and(
        eq(tenantCustomHostnames.organizationId, organizationId),
        gte(tenantCustomHostnames.createdAt, since)
      )
    );
  const n = row?.n ?? 0;
  if (n >= DAILY_LIMIT) {
    throw new TenancyRateLimitError("daily_quota", 86_400);
  }
}
