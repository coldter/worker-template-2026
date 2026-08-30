import {
  createAuthSchema,
  type Principal,
  principalAttribute,
  principalNotActive,
} from "@repo/authorization";
import { SYSTEM_ROLE_SLUG_VALUES } from "./roles";
import { USER_STATUS_VALUES, type UserStatus } from "./users";

export const auth = createAuthSchema({
  globalPolicies: (p) => [p.deny("*").to("*").where(principalNotActive())],
  organizationRoles: ["owner", "admin", "member"],
  principal: {
    email: principalAttribute<string>(),
    emailVerified: principalAttribute<boolean>(),
    status: principalAttribute<UserStatus>(),
  },
  relations: ["owner", "member"],
  roles: ["admin", "user"],
  systemAdminRoles: ["admin"],
});

export type AuthorizationRole = (typeof auth)["roleValues"][number];
export type AuthorizationOrgRole = (typeof auth)["orgRoleValues"][number];
export type AuthorizationAttributes = {
  status: UserStatus;
  email: string;
  emailVerified: boolean;
};
export type AuthorizationPrincipal = Principal<
  AuthorizationRole,
  AuthorizationAttributes,
  AuthorizationOrgRole
>;

const VALID_ORG_ROLES = new Set<AuthorizationOrgRole>([
  "owner",
  "admin",
  "member",
]);

export function isAuthorizationRole(slug: string): slug is AuthorizationRole {
  return SYSTEM_ROLE_SLUG_VALUES.includes(slug as AuthorizationRole);
}

export function isAuthorizationOrgRole(
  role: string
): role is AuthorizationOrgRole {
  return VALID_ORG_ROLES.has(role as AuthorizationOrgRole);
}

export const VALID_STATUSES = new Set<AuthorizationAttributes["status"]>(
  USER_STATUS_VALUES
);

interface UserAuthorizationResource {
  id: string;
}

export const usersAuthorization =
  auth.createResource<UserAuthorizationResource>("user", {
    actions: [
      "list",
      "view",
      "create",
      "update",
      "update-roles",
      "delete",
      "deactivate",
      "activate",
      "unlock",
    ],
    policies: (p) => [
      p.allow("admin").to("*"),
      p.allow("user").to("list"),
      p.allow("user").to("view", "update").whereOwner(),
      p.deny("*").to("delete").whereTargetIsSelf(),
      p.deny("*").to("deactivate").whereTargetIsSelf(),
    ],
    resolveOwner: (resource) => resource.id,
  });

export const rolesAuthorization = auth.createResource<Record<string, never>>(
  "role",
  {
    actions: ["list", "view", "update"],
    policies: (p) => [p.allow("admin").to("*"), p.allow("user").to("list")],
  }
);

export const auditLogsAuthorization = auth.createResource<
  Record<string, never>
>("audit-log", {
  actions: ["list", "view"],
  policies: (p) => [p.allow("admin").to("*")],
});

export const notificationsAuthorization = auth.createResource<
  Record<string, never>
>("notification", {
  actions: [
    "list",
    "view",
    "mark-read",
    "mark-all-read",
    "get-preferences",
    "update-preferences",
    "list-push-tokens",
    "register-push-token",
    "delete-push-token",
    "get-unread-count",
  ],
  policies: (p) => [p.allow("admin").to("*"), p.allow("user").to("*")],
});

export const authorization = auth.buildRegistry({
  "audit-log": auditLogsAuthorization,
  notification: notificationsAuthorization,
  role: rolesAuthorization,
  user: usersAuthorization,
});
