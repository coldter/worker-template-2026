import { createDrizzleClient } from "@repo/db/client";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { createMiddleware } from "hono/factory";
import { Client } from "pg";
import type { AppEnv } from "@/lib/context";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const client = new Client({
    connectionString: c.env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  c.set(
    "db",
    createDrizzleClient(
      client,
      process.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined
    )
  );
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});
