import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";

const app = new OpenAPIHono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok" }, 200));

app.get("/ready", (c) => {
  const checks = {
    hyperdrive: !!c.env.HYPERDRIVE,
    cache: !!c.env.CACHE,
  };
  const allReady = Object.values(checks).every(Boolean);
  return c.json(
    { status: allReady ? "ready" : "unavailable", checks },
    allReady ? 200 : 503
  );
});

export default app;
