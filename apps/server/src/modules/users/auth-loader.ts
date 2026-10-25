import { users } from "@repo/db/schema";
import type { UserAuthorizationResource } from "@repo/shared/authorization";
import { eq } from "drizzle-orm";
import type { Context } from "hono";

import { getAuthorizedResource } from "@/auth/middleware";
import type { AppEnv } from "@/lib/context";

export const loadUserResource = async (
  c: Context<AppEnv>
): Promise<UserAuthorizationResource | null> => {
  const userId = c.req.param("userId");

  if (!userId) {
    return null;
  }

  const [row] = await c.var.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
};

export const loadCurrentUserResource = (
  c: Context<AppEnv>
): Promise<UserAuthorizationResource | null> => {
  const currentUser = c.get("user");

  return Promise.resolve(currentUser ? { id: currentUser.id } : null);
};

export const requireAuthorizedUserId = (c: Context<AppEnv>): string =>
  getAuthorizedResource<UserAuthorizationResource>(c).id;
