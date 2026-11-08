import type { createDrizzleClient } from "@repo/db/client";
import { withDrizzleClient } from "@repo/db/client";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { z } from "zod";

import { createAuth } from "./instance";
import type { AuthBindings } from "./instance";

const cfPropertiesSchema = z.object({
  colo: z.string().optional().catch(undefined),
  country: z.string().optional().catch(undefined),
});

interface AuthEnv {
  Bindings: CloudflareBindings;
  Variables: {
    db: ReturnType<typeof createDrizzleClient>;
  };
}

const app = new Hono<AuthEnv>();

app.use("*", trimTrailingSlash());

app.use("*", async (c, proceed) => {
  const start = Date.now();
  await proceed();
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
  } catch (error) {
    logger.debug("Analytics writeDataPoint failed", {
      error,
    });
  }
});

app.use("*", async (c, proceed) => {
  await withDrizzleClient(
    c.env.HYPERDRIVE.connectionString,
    async (db) => {
      c.set("db", db);
      await proceed();
    },
    {
      logger:
        c.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    }
  );
});

app.all("/*", (c) => {
  // SAFETY: the API service binding targets the server worker's ApiEntrypoint, so it exposes the ApiBindingRpc methods at runtime.
  const auth = createAuth(c.var.db, c.env as AuthBindings, c.executionCtx);

  return auth.handler(c.req.raw);
});

export default app;
