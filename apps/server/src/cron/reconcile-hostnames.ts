import { withDrizzleClient } from "@repo/db";
import { logger } from "@repo/shared/logger";
import type { AppBindings } from "@/lib/context";
import { createServerInvalidator } from "@/middlewares/invalidator";
import { createCfBudgetGuard } from "@/modules/tenancy/cf-budget";
import {
  customHostnameLifecycle,
  type LifecycleEnv,
} from "@/modules/tenancy/lifecycle";

/** Lifecycle env subset out of `CloudflareBindings`. */
function pickLifecycleEnv(env: CloudflareBindings): LifecycleEnv {
  return {
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ZONE_ID: env.CLOUDFLARE_ZONE_ID,
    CUSTOM_HOST_CNAME_TARGET: env.CUSTOM_HOST_CNAME_TARGET,
    CUSTOM_HOST_VERIFICATION_LABEL: env.CUSTOM_HOST_VERIFICATION_LABEL,
  };
}

/**
 * Build a FanOutInvalidator from the raw worker env. The `AUTH` binding gains
 * RPC methods at runtime via `AuthBindingRpc` — the raw `CloudflareBindings`
 * type does not surface those, so we widen via `AppBindings`.
 */
function buildInvalidator(env: CloudflareBindings) {
  // boundary: see comment above.
  return createServerInvalidator(env as unknown as AppBindings);
}

/**
 * A5 / D9 — 60s scheduled hostname reconciler.
 *
 * Thin wrapper: builds a Drizzle client + FanOutInvalidator, delegates to
 * `customHostnameLifecycle.reconcileAll`. All batch + per-row logic lives in
 * the service. Trace sampling is bumped to 100% via wrangler config.
 */
export async function reconcileHostnamesScheduled(
  _controller: ScheduledController,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<void> {
  const cronRunId = crypto.randomUUID();
  const invalidator = buildInvalidator(env);
  try {
    await withDrizzleClient(
      env.HYPERDRIVE.connectionString,
      async (db) => {
        await customHostnameLifecycle.reconcileAll(db, pickLifecycleEnv(env), {
          invalidator,
          cache: env.CACHE,
          cronRunId,
          cfBudget: createCfBudgetGuard(env.CACHE),
        });
      },
      { waitUntil: (p) => ctx.waitUntil(p) }
    );
  } catch (cause) {
    logger.error("cron.reconcile.failed", {
      cronRunId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
