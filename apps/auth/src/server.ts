import { createDrizzleClient } from "@repo/db/client";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { Client } from "pg";
import { type AuthBindings, createAuth } from "./instance";

type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    db: ReturnType<typeof createDrizzleClient>;
  };
};

const app = new Hono<AuthEnv>();

app.use("*", trimTrailingSlash());

// DB middleware - creates and manages connection per request
app.use("*", async (c, next) => {
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

app.all("/*", async (c) => {
  const auth = createAuth(c.var.db, c.env as AuthBindings, c.executionCtx);
  return auth.handler(c.req.raw);
});

export default app;
