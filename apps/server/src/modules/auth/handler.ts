import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";
import { defaultHook } from "@/utils/default-hook";
import { createAuth } from "./instance";
import rolesHandler from "./roles/handler";

const app = new OpenAPIHono<AppEnv>({ defaultHook });

// Mount roles handler before the catch-all
app.route("/roles", rolesHandler);

// Better Auth catch-all handler
app.all("/*", async (c) => {
  const auth = createAuth(c.var.db, c.executionCtx);
  return auth.handler(c.req.raw);
});

export default app;
