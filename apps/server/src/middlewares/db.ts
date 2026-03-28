import { createDrizzleClient } from "@repo/db/client";
import { createMiddleware } from "hono/factory";
import { Client } from "pg";
import type { AppEnv } from "@/lib/context";
import { DrizzleLogger } from "@/lib/logger-drizzle";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const client = new Client({
    connectionString: c.env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  c.set("db", createDrizzleClient(client, new DrizzleLogger()));
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});
