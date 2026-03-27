import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";
import { createAuth } from "@/modules/auth/instance";

export const authContextMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const auth = createAuth(c.var.db, c.executionCtx);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);
    await next();
  }
);
