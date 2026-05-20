import {
  createAuthSchema,
  type Principal,
  principalAttribute,
  principalNotActive,
} from "@repo/authorization";
import { logger } from "./logger";
import { SYSTEM_ROLE_SLUG_VALUES, SYSTEM_ROLES } from "./roles";

export { SYSTEM_ROLE_SLUG_VALUES, SYSTEM_ROLES } from "./roles";

export const auth = createAuthSchema({
  roles: ["admin", "user"],
  systemAdminRoles: ["admin"],
  relations: ["owner", "member"],
  organizationRoles: ["owner", "admin", "member"],
  principal: {
    status: principalAttribute<"active" | "inactive" | "locked" | "deleted">(),
    email: principalAttribute<string>(),
    emailVerified: principalAttribute<boolean>(),
  },
  globalPolicies: (p) => [p.deny("*").to("*").where(principalNotActive())],
});

export type AuthorizationRole = (typeof auth)["roleValues"][number];
export type AuthorizationOrgRole = (typeof auth)["orgRoleValues"][number];
export type AuthorizationAttributes = {
  status: "active" | "inactive" | "locked" | "deleted";
  email: string;
  emailVerified: boolean;
};
export type AuthorizationPrincipal = Principal<
  AuthorizationRole,
  AuthorizationAttributes,
  AuthorizationOrgRole
>;

export type AuthorizationUserInput = {
  email?: string;
  emailVerified?: boolean;
  id: string;
  roleSlugs?: string[] | null;
  status?: string;
};

export type AuthorizationSessionInput = {
  activeOrganizationId?: string | null;
  activeOrgRole?: string | null;
};

const VALID_STATUSES = new Set<AuthorizationAttributes["status"]>([
  "active",
  "inactive",
  "locked",
  "deleted",
]);

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

export function buildAuthorizationPrincipal(
  user: AuthorizationUserInput,
  session: AuthorizationSessionInput = {}
): AuthorizationPrincipal {
  const allSlugs = user.roleSlugs ?? [];
  const roles = allSlugs.filter(isAuthorizationRole);
  const droppedRoles = allSlugs.filter((role) => !isAuthorizationRole(role));

  if (droppedRoles.length > 0) {
    for (const roleSlug of droppedRoles) {
      logger.warn("Unknown role slug", {
        event: "authorization.unknown_role_slug",
        roleSlug,
        userId: user.id,
      });
    }
  }

  const requestedStatus = user.status ?? "active";
  const status = VALID_STATUSES.has(
    requestedStatus as AuthorizationAttributes["status"]
  )
    ? (requestedStatus as AuthorizationAttributes["status"])
    : "active";

  return {
    id: user.id,
    roles,
    attributes: {
      status,
      email: user.email ?? "",
      emailVerified: user.emailVerified ?? false,
    },
    ...(session.activeOrganizationId &&
    session.activeOrgRole &&
    isAuthorizationOrgRole(session.activeOrgRole)
      ? {
          organization: {
            id: session.activeOrganizationId,
            role: session.activeOrgRole,
          },
        }
      : {}),
  };
}

export function toBaseAuthorizationPrincipal(
  principal: AuthorizationPrincipal
): Principal {
  return {
    id: principal.id,
    roles: principal.roles,
    attributes: principal.attributes,
  };
}

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

interface NotificationResource {
  // Recipient user id (notifications.user_id). The owner is the user the
  // notification was delivered to; only that user (and admins) may view
  // or mutate it. Without this gate, `p.allow("user").to("*")` lets any
  // authenticated user mark-read another user's notifications.
  userId: string;
}

export const notificationsAuthorization =
  auth.createResource<NotificationResource>("notification", {
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
    resolveOwner: (resource) => resource.userId,
    policies: (p) => [
      p.allow("admin").to("*"),
      // Listing/preferences/push-token actions and mark-all-read are
      // collection-level (no resource); they are gated by role only and
      // the service layer must filter results to the calling principal.
      p
        .allow("user")
        .to(
          "list",
          "mark-all-read",
          "get-preferences",
          "update-preferences",
          "list-push-tokens",
          "register-push-token",
          "delete-push-token",
          "get-unread-count"
        ),
      // Per-row actions are gated by ownership: a user may only view or
      // mark-read their own notifications.
      p.allow("user").to("view", "mark-read").whereOwner(),
    ],
  });

interface SsoProviderResource {
  id: string;
  organizationId: string;
}

// Owner and admin org-roles can manage SSO providers for their tenant.
// All operations are scoped to the resolved tenant org — cross-tenant access
// is prevented by service-layer org enforcement (A4.4).
export const ssoProviderAuthorization =
  auth.createResource<SsoProviderResource>("sso_provider", {
    actions: ["create", "read", "update", "delete", "rotate_secret"],
    resolveOrganization: (resource) => resource.organizationId,
    policies: (p) => [
      p
        .allow("*")
        .to("create", "read", "update", "delete", "rotate_secret")
        .withOrgRole("owner", "admin"),
    ],
  });

interface CustomHostnameResource {
  id: string;
  organizationId: string;
}

// A5 — only org owners and admins can manage custom hostnames. Service-layer
// scoping (A5.4) re-checks `actor.organizationId` against the row.
export const customHostnameAuthorization =
  auth.createResource<CustomHostnameResource>("custom_hostname", {
    actions: ["create", "list", "verify", "remove"],
    resolveOrganization: (resource) => resource.organizationId,
    policies: (p) => [
      p
        .allow("*")
        .to("create", "list", "verify", "remove")
        .withOrgRole("owner", "admin"),
    ],
  });

export const authorization = auth.buildRegistry({
  user: usersAuthorization,
  role: rolesAuthorization,
  "audit-log": auditLogsAuthorization,
  notification: notificationsAuthorization,
  sso_provider: ssoProviderAuthorization,
  custom_hostname: customHostnameAuthorization,
});

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
