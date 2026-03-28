import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const authContextMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const session = await c.env.AUTH.getSession(c.req.raw.headers);
    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);
    await next();
  }
);
