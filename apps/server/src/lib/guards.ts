import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv, AuthUser } from "@/lib/context";

type TenantContext = NonNullable<AppEnv["Variables"]["tenant"]>;

// `cause.code` is lifted into the response envelope by errorHandler (middlewares/error.ts).
export function requireTenant(c: Context<AppEnv>): TenantContext {
  const tenant = c.get("tenant");
  if (!tenant) {
    throw new HTTPException(403, {
      message: "Tenant required",
      cause: { code: "TENANT_REQUIRED" },
    });
  }
  return tenant;
}

export function requireCurrentUser(c: Context<AppEnv>): AuthUser {
  const currentUser = c.get("user");
  if (!currentUser) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return currentUser;
}
