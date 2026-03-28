import {
  getPermissionKey,
  type PermissionIdentifier,
  type PermissionKey,
} from "@repo/shared/permissions";
import type { DrizzleClient } from "./client";

type UserWithRoles = { roleSlugs: string[] };

export function hasRole(user: UserWithRoles, role: string): boolean {
  return user.roleSlugs.includes(role);
}

export async function hasPermission(
  db: DrizzleClient,
  user: UserWithRoles,
  permission: PermissionIdentifier
): Promise<boolean> {
  if (!user.roleSlugs.length) {
    return false;
  }

  const userRoles = await db.query.roles.findMany({
    where: { slug: { in: user.roleSlugs }, deletedAt: { isNull: true } },
    columns: { permissions: true },
  });

  const castedUserRoles = userRoles as Array<{ permissions: PermissionKey[] }>;
  const permissionKey = getPermissionKey(permission) as PermissionKey;

  for (const role of castedUserRoles) {
    if (role.permissions.includes("*")) {
      return true;
    }
    if (role.permissions.includes(permissionKey)) {
      return true;
    }
  }

  return false;
}

export async function hasAnyPermission(
  db: DrizzleClient,
  user: UserWithRoles,
  permissionList: PermissionIdentifier[]
): Promise<boolean> {
  for (const permission of permissionList) {
    if (await hasPermission(db, user, permission)) {
      return true;
    }
  }
  return false;
}
