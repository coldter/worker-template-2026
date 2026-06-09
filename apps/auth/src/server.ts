import { withDrizzleClient } from "@repo/db";
import type { createDrizzleClient } from "@repo/db/client";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { type AuthBindings, createAuth } from "./instance";

type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    db: ReturnType<typeof createDrizzleClient>;
  };
};

const app = new Hono<AuthEnv>();

app.use("*", trimTrailingSlash());

// Per-request DB connection lifecycle.
app.use("*", async (c, next) => {
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

app.all("/*", async (c) => {
  const auth = createAuth(c.var.db, c.env as AuthBindings, c.executionCtx);
  return auth.handler(c.req.raw);
});

export default app;
