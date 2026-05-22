// Transitional: legacy permission keys retained until clients migrate to authorization resources.
import type { AuthorizationRole } from "./authorization-schema";
import { SYSTEM_ROLES } from "./roles";

export const LEGACY_PERMISSION_KEYS = [
  "dashboard:access",
  "users:view",
  "users:create",
  "users:update",
  "users:delete",
  "users:deactivate",
  "users:activate",
  "users:unlock",
  "roles:view",
  "roles:update",
  "audit-logs:view",
] as const;

export type LegacyPermissionValue = (typeof LEGACY_PERMISSION_KEYS)[number];
export type LegacyPermissionKey = LegacyPermissionValue | "*";

const LEGACY_PERMISSION_SET = new Set<LegacyPermissionValue>(
  LEGACY_PERMISSION_KEYS
);

export function isLegacyPermissionKey(
  value: string
): value is LegacyPermissionValue {
  return LEGACY_PERMISSION_SET.has(value as LegacyPermissionValue);
}

export function getLegacyPermissionKeysForRole(
  role: AuthorizationRole
): LegacyPermissionValue[] {
  return role === SYSTEM_ROLES.ADMIN.slug ? [...LEGACY_PERMISSION_KEYS] : [];
}
