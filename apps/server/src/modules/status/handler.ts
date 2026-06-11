import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";
import { dbMiddleware } from "@/middlewares/db";
import { checkReadiness } from "./service";

const app = new OpenAPIHono<AppEnv>();

// The version id lets an uptime check (or a human with curl) confirm which
// deploy is actually serving traffic.
app.get("/health", (c) =>
  c.json({ status: "ok", version: c.env.CF_VERSION_METADATA?.id }, 200)
);

// Status routes are mounted outside the /api/* middleware chain, so /ready
// must opt in to dbMiddleware itself; /health stays dependency-free.
app.use("/ready", dbMiddleware);
app.get("/ready", async (c) => {
  const checks = await checkReadiness(c.var.db, c.env.CACHE);
  const ready = checks.database && checks.cache;
  return c.json(
    { status: ready ? "ok" : "unavailable", checks },
    ready ? 200 : 503
  );
});

export default app;
