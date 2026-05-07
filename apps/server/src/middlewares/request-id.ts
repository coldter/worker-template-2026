import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

// Accepts any URL-safe identifier shape between 8 and 128 chars: UUIDv4,
// UUIDv7, ULID, ksuid, nanoid, etc. Hyphens and underscores are allowed.
// Stricter than passing the header through unmodified (which would let a
// caller inject CRLFs or reflected payloads) but loose enough to honor
// upstream id formats other than UUIDv4.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header("X-Request-Id");
  const requestId =
    inbound !== undefined && REQUEST_ID_RE.test(inbound)
      ? inbound
      : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});
