import { withDrizzleClient } from "@repo/db";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  await withDrizzleClient(
    c.env.HYPERDRIVE.connectionString,
    async (db) => {
      c.set("db", db);
      await next();
    },
    {
      logger:
        process.env.NODE_ENV === "development"
          ? new DrizzleLogger()
          : undefined,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    }
  );
});
