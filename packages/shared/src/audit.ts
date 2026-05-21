import { redact } from "./logger";

export const ACTOR_TYPES = {
  USER: "user",
  SYSTEM: "system",
  API: "api",
  GLOBAL_ADMIN: "global_admin",
} as const;

export type ActorType = (typeof ACTOR_TYPES)[keyof typeof ACTOR_TYPES];

export const TARGET_TYPES = {
  USER: "user",
  ROLE: "role",
  SESSION: "session",
  HOSTNAME: "hostname",
  CUSTOM_HOSTNAME: "custom_hostname",
  SSO_PROVIDER: "sso_provider",
  ORGANIZATION: "organization",
  TENANT: "tenant",
} as const;

export type TargetType = (typeof TARGET_TYPES)[keyof typeof TARGET_TYPES];

/**
 * Classification of an audit event.
 *
 * - `critical`: occurs alongside a database write. Must be logged
 *   transactionally via `auditLogService.create(input, executor)`.
 * - `bufferable`: observational, with no accompanying business write. Logged
 *   asynchronously via `auditLogService.enqueue(input)`.
 *
 * The `kind` field on each AUDIT_EVENTS entry is the single source of truth.
 * The runtime arrays `CRITICAL_EVENTS` / `BUFFERABLE_EVENTS` and the
 * corresponding `CriticalAuditEvent` / `BufferableAuditEvent` types are
 * derived from it below — there is no parallel list to keep in sync.
 */
export type AuditEventKind = "critical" | "bufferable";

export const AUDIT_EVENTS = {
  AUTH: {
    LOGIN_SUCCESS: {
      event: "auth.login.success",
      description: "User logged in",
      kind: "bufferable",
    },
    LOGIN_FAILED: {
      event: "auth.login.failed",
      description: "Failed login attempt",
      kind: "bufferable",
    },
    LOGOUT: {
      event: "auth.logout",
      description: "User logged out",
      kind: "bufferable",
    },
    PASSWORD_CHANGED: {
      event: "auth.password.changed",
      description: "Password changed",
      kind: "critical",
    },
    SESSION_REVOKED: {
      event: "auth.session.revoked",
      description: "Session revoked",
      kind: "critical",
    },
  },
  USER: {
    CREATED: {
      event: "user.created",
      description: "User created",
      kind: "critical",
    },
    UPDATED: {
      event: "user.updated",
      description: "User updated",
      kind: "critical",
    },
    DELETED: {
      event: "user.deleted",
      description: "User deleted",
      kind: "critical",
    },
    DEACTIVATED: {
      event: "user.deactivated",
      description: "User deactivated",
      kind: "critical",
    },
    ACTIVATED: {
      event: "user.activated",
      description: "User activated",
      kind: "critical",
    },
    UNLOCKED: {
      event: "user.unlocked",
      description: "User unlocked",
      kind: "critical",
    },
    VIEWED: {
      event: "user.viewed",
      description: "User viewed",
      kind: "bufferable",
    },
    LISTED: {
      event: "user.listed",
      description: "Users listed",
      kind: "bufferable",
    },
  },
  ROLE: {
    CREATED: {
      event: "role.created",
      description: "Role created",
      kind: "critical",
    },
    UPDATED: {
      event: "role.updated",
      description: "Role updated",
      kind: "critical",
    },
    DELETED: {
      event: "role.deleted",
      description: "Role deleted",
      kind: "critical",
    },
    ASSIGNED: {
      event: "role.assigned",
      description: "Role assigned",
      kind: "critical",
    },
    UNASSIGNED: {
      event: "role.unassigned",
      description: "Role unassigned",
      kind: "critical",
    },
  },
  HOSTNAME: {
    ADDED: {
      event: "hostname.added",
      description: "Custom hostname added",
      kind: "critical",
    },
    VERIFIED: {
      event: "hostname.verified",
      description: "Custom hostname verified",
      kind: "critical",
    },
    ACTIVATED: {
      event: "hostname.activated",
      description: "Custom hostname activated",
      kind: "critical",
    },
    DELETED: {
      event: "hostname.deleted",
      description: "Custom hostname deleted",
      kind: "critical",
    },
    FAILED: {
      event: "hostname.failed",
      description: "Custom hostname provisioning failed",
      kind: "bufferable",
    },
    REQUESTED: {
      event: "tenancy.custom_hostname.requested",
      description: "Custom hostname request created (TXT pre-verification)",
      kind: "critical",
    },
    TXT_VERIFIED: {
      event: "tenancy.custom_hostname.verified",
      description: "Custom hostname TXT verified and registered with CF",
      kind: "critical",
    },
    LIFECYCLE_ACTIVATED: {
      event: "tenancy.custom_hostname.activated",
      description: "Custom hostname activated (CF cert issued)",
      kind: "critical",
    },
    LIFECYCLE_DEACTIVATED: {
      event: "tenancy.custom_hostname.deactivated",
      description:
        "Custom hostname deactivated (CF cert expired or operator deactivated)",
      kind: "critical",
    },
    REMOVED: {
      event: "tenancy.custom_hostname.removed",
      description: "Custom hostname removed by tenant",
      kind: "critical",
    },
    DELETED_BY_CF: {
      event: "tenancy.custom_hostname.deleted_by_cf",
      description: "Custom hostname deleted by Cloudflare after backoff",
      kind: "critical",
    },
    CF_CREATE_FAILED: {
      event: "tenancy.custom_hostname.cf_create_failed",
      description: "CF createCustomHostname failed after TXT verification",
      kind: "bufferable",
    },
  },
  SSO: {
    PROVIDER_CREATED: {
      event: "sso.provider.created",
      description: "SSO provider created",
      kind: "critical",
    },
    PROVIDER_UPDATED: {
      event: "sso.provider.updated",
      description: "SSO provider updated",
      kind: "critical",
    },
    PROVIDER_DELETED: {
      event: "sso.provider.deleted",
      description: "SSO provider deleted",
      kind: "critical",
    },
    DOMAIN_VERIFIED: {
      event: "sso.domain.verified",
      description: "SSO domain verified",
      kind: "critical",
    },
    SECRET_ROTATED: {
      event: "sso.secret.rotated",
      description: "SSO provider client secret rotated",
      kind: "critical",
    },
  },
  ORG: {
    CREATED: {
      event: "org.created",
      description: "Organization created",
      kind: "critical",
    },
    UPDATED: {
      event: "org.updated",
      description: "Organization updated",
      kind: "critical",
    },
    SUSPENDED: {
      event: "org.suspended",
      description: "Organization suspended",
      kind: "critical",
    },
    UNSUSPENDED: {
      event: "org.unsuspended",
      description: "Organization unsuspended",
      kind: "critical",
    },
    DELETED: {
      event: "org.deleted",
      description: "Organization deleted",
      kind: "critical",
    },
    SSO_ENFORCED: {
      event: "org.sso_enforced",
      description: "SSO enforcement enabled for organization",
      kind: "critical",
    },
    SSO_UNENFORCED: {
      event: "org.sso_unenforced",
      description: "SSO enforcement disabled for organization",
      kind: "critical",
    },
    INVITATION_PARTIAL_FAILURE: {
      event: "org.invitation.partial_failure",
      description:
        "Invitation accept flow failed mid-way; user created but invitation not accepted",
      kind: "critical",
    },
  },
  OPERATOR: {
    ACCESS_DENIED: {
      event: "operator.access.denied",
      description:
        "Operator middleware denied access (insufficient role or unauthenticated)",
      kind: "bufferable",
    },
  },
  GLOBAL_ADMIN: {
    DEACTIVATED: {
      event: "global_admin.deactivated",
      description: "Global admin deactivated",
      kind: "critical",
    },
  },
  TENANT: {
    CREATED: {
      event: "tenant.created",
      description:
        "Tenant created by an operator (organization + invitation row)",
      kind: "critical",
    },
    PROVISIONED: {
      event: "tenant.provisioned",
      description: "Tenant provisioned",
      kind: "critical",
    },
    DEPROVISIONED: {
      event: "tenant.deprovisioned",
      description: "Tenant deprovisioned",
      kind: "critical",
    },
    SESSION_INVALIDATED: {
      event: "tenant.session_invalidated",
      description: "All tenant sessions invalidated",
      kind: "critical",
    },
    SUSPENDED: {
      event: "tenant.suspended",
      description: "Tenant operations suspended; sessions revoked",
      kind: "critical",
    },
    SUSPENDED_NOOP: {
      event: "tenant.suspended.noop",
      description: "Suspend called on already-suspended tenant",
      kind: "bufferable",
    },
    RESTORED: {
      event: "tenant.restored",
      description: "Tenant operations resumed",
      kind: "critical",
    },
    RESTORED_NOOP: {
      event: "tenant.restored.noop",
      description: "Restore called on non-suspended tenant",
      kind: "bufferable",
    },
  },
} as const satisfies Record<
  string,
  Record<string, { event: string; description: string; kind: AuditEventKind }>
>;

type AuditEventObject = {
  [K in keyof typeof AUDIT_EVENTS]: {
    [E in keyof (typeof AUDIT_EVENTS)[K]]: (typeof AUDIT_EVENTS)[K][E];
  }[keyof (typeof AUDIT_EVENTS)[K]];
}[keyof typeof AUDIT_EVENTS];

export type AuditEventKey = AuditEventObject extends { event: infer E }
  ? E extends string
    ? E
    : string
  : string;

type AuditEventOfKind<K extends AuditEventKind> = Extract<
  AuditEventObject,
  { kind: K }
>;

export type CriticalAuditEvent = AuditEventOfKind<"critical">["event"];
export type BufferableAuditEvent = AuditEventOfKind<"bufferable">["event"];

export interface FieldChange<T = unknown> {
  from: T;
  to: T;
}

export interface AuditLogMetadata {
  changedFields?: string[];
  changes?: Record<string, FieldChange>;
  [key: string]: unknown;
}

/**
 * Run the audit-log metadata payload through the same redactor used for
 * structured logs. Audit rows persist to the database and may be replayed in
 * support tooling, so sensitive fields that leak into `metadata` would
 * otherwise outlive the request.
 */
// boundary: redact() walks an arbitrary JSON-shaped value and rebuilds it.
// The runtime contract preserves AuditLogMetadata's shape -- top-level keys
// survive, only sensitive values are replaced -- so the cast back to
// AuditLogMetadata is safe by construction.
export function redactAuditMetadata(
  metadata: AuditLogMetadata
): AuditLogMetadata {
  return redact(metadata) as AuditLogMetadata;
}

const ALL_AUDIT_ENTRIES = Object.values(AUDIT_EVENTS).flatMap((group) =>
  Object.values(group)
) as readonly {
  event: string;
  description: string;
  kind: AuditEventKind;
}[];

export const CRITICAL_EVENTS: readonly CriticalAuditEvent[] =
  ALL_AUDIT_ENTRIES.filter((e) => e.kind === "critical").map(
    (e) => e.event
  ) as readonly CriticalAuditEvent[];

export const BUFFERABLE_EVENTS: readonly BufferableAuditEvent[] =
  ALL_AUDIT_ENTRIES.filter((e) => e.kind === "bufferable").map(
    (e) => e.event
  ) as readonly BufferableAuditEvent[];
