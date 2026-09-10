import type { createDrizzleClient } from "@repo/db/client";
import { withDrizzleClient } from "@repo/db/client";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { z } from "zod";
import { type AuthBindings, createAuth } from "./instance";

const cfPropertiesSchema = z.object({
  colo: z.string().optional().catch(undefined),
  country: z.string().optional().catch(undefined),
});

type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    db: ReturnType<typeof createDrizzleClient>;
  };
};

const app = new Hono<AuthEnv>();

app.use("*", trimTrailingSlash());

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    const { path } = c.req;
    const cf = cfPropertiesSchema.safeParse(c.req.raw.cf);
    c.env.ANALYTICS?.writeDataPoint({
      blobs: [
        "auth",
        c.req.method,
        path,
        cf.data?.country ?? null,
        cf.data?.colo ?? null,
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
  // SAFETY: the API service binding targets the server worker's ApiEntrypoint, so it exposes the ApiBindingRpc methods at runtime.
  const auth = createAuth(c.var.db, c.env as AuthBindings, c.executionCtx);
  return auth.handler(c.req.raw);
});

export default app;
