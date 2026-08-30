import { withDrizzleClient } from "@repo/db";
import type { createDrizzleClient } from "@repo/db/client";
import { logger } from "@repo/shared/logger";
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

// Auth requests bypass the server worker's analytics middleware (the proxy
// forwards them untouched), so sign-in failure rates and latency need their
// own unsampled dataset; Workers Logs alone is head-sampled at 25%.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    const { path } = c.req;
    const { cf } = c.req.raw;
    c.env.ANALYTICS?.writeDataPoint({
      blobs: [
        "auth",
        c.req.method,
        path,
        typeof cf?.country === "string" ? cf.country : null,
        typeof cf?.colo === "string" ? cf.colo : null,
        c.env.CF_VERSION_METADATA?.id ?? null,
      ],
      doubles: [c.res.status, duration],
      indexes: [path],
    });
  } catch (err) {
    logger.debug("Analytics writeDataPoint failed", {
      error: err,
    });
  }
});

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
