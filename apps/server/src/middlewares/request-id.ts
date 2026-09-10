import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.-]{8,128}$/;

export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const requestId =
    incoming && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});
