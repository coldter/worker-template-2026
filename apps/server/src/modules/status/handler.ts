import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";
import { dbMiddleware } from "@/middlewares/db";
import { checkReadiness } from "./service";

const app = new OpenAPIHono<AppEnv>();

app.get("/health", (c) =>
  c.json({ status: "ok", version: c.env.CF_VERSION_METADATA?.id }, 200)
);

app.use("/ready", dbMiddleware);
app.get("/ready", async (c) => {
  const checks = await checkReadiness(c.var.db, c.env.CACHE);
  const ready = checks.database && checks.cache;
  return c.json(
    { checks, status: ready ? "ok" : "unavailable" },
    ready ? 200 : 503
  );
});

export default app;
