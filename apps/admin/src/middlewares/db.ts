import { withDrizzleClient } from "@repo/db";
import { createMiddleware } from "hono/factory";
import type { AdminEnv } from "@/env";

/**
 * Wrap each request in a per-request Drizzle client backed by Hyperdrive.
 * Mirrors `apps/server/src/middlewares/db.ts`. Connection lifecycle is
 * tied to the request via `executionCtx.waitUntil`.
 */
export const dbMiddleware = createMiddleware<AdminEnv>(async (c, next) => {
  await withDrizzleClient(
    c.env.HYPERDRIVE.connectionString,
    async (db) => {
      c.set("db", db);
      await next();
    },
    {
      waitUntil: (p) => {
        try {
          c.executionCtx.waitUntil(p);
        } catch {
          // No execution ctx in tests; let the connection close in the
          // foreground.
        }
      },
    }
  );
});
