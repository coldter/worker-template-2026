import { z } from "zod";

import type { ListAuditLogsResponse } from "@/api.gen/types.gen";

interface BadgeStyle {
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
}

export type AuditLogMetadataValue =
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "array"; items: AuditLogMetadataValue[] }
  | { kind: "object"; fields: Record<string, AuditLogMetadataValue> };

export type AuditLogMetadata = Record<string, AuditLogMetadataValue>;

const metadataValueSchema: z.ZodType<AuditLogMetadataValue> = z.lazy(() =>
  z.union([
    z.null().transform((): AuditLogMetadataValue => ({ kind: "null" })),
    z.boolean().transform((value): AuditLogMetadataValue => ({
      kind: "boolean",
      value,
    })),
    z
      .number()
      .transform((value): AuditLogMetadataValue => ({ kind: "number", value })),
    z
      .string()
      .transform((value): AuditLogMetadataValue => ({ kind: "string", value })),
    z
      .array(metadataValueSchema)
      .transform((items): AuditLogMetadataValue => ({ items, kind: "array" })),
    z
      .record(z.string(), metadataValueSchema)
      .transform((fields): AuditLogMetadataValue => ({
        fields,
        kind: "object",
      })),
  ])
);

const auditLogMetadataSchema = z.record(z.string(), metadataValueSchema);

type RawAuditLogMetadata = ListAuditLogsResponse["data"][number]["metadata"];

export const decodeAuditLogMetadata = (
  metadata: RawAuditLogMetadata
): AuditLogMetadata | null => {
  if (metadata === null) {
    return null;
  }

  const parsed = auditLogMetadataSchema.safeParse(metadata);

  return parsed.success ? parsed.data : null;
};

export type AuditLogMetadataRawValue =
  | null
  | boolean
  | number
  | string
  | AuditLogMetadataRawValue[]
  | { [key: string]: AuditLogMetadataRawValue };

const encodeMetadataValue = (
  value: AuditLogMetadataValue
): AuditLogMetadataRawValue => {
  if (value.kind === "array") {
    return value.items.map(encodeMetadataValue);
  }

  if (value.kind === "object") {
    return Object.fromEntries(
      Object.entries(value.fields).map(([key, entry]) => [
        key,
        encodeMetadataValue(entry),
      ])
    );
  }

  return value.kind === "null" ? null : value.value;
};

export const encodeAuditLogMetadata = (
  metadata: AuditLogMetadata
): Record<string, AuditLogMetadataRawValue> =>
  Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      encodeMetadataValue(value),
    ])
  );

export const formatMetadataValue = (value: AuditLogMetadataValue): string => {
  if (value.kind === "null") {
    return "null";
  }

  if (value.kind === "array") {
    return value.items.map(formatMetadataValue).join(",");
  }

  if (value.kind === "object") {
    return "[object Object]";
  }

  return String(value.value);
};

const isPresentMetadataValue = (
  value: AuditLogMetadataValue | undefined
): boolean => {
  if (value === undefined || value.kind === "null") {
    return false;
  }

  if (value.kind === "boolean") {
    return value.value;
  }

  if (value.kind === "number") {
    return value.value !== 0;
  }

  if (value.kind === "string") {
    return value.value.length > 0;
  }

  return true;
};

const presentMetadataValueText = (
  value: AuditLogMetadataValue | undefined
): string | null => {
  if (value === undefined || !isPresentMetadataValue(value)) {
    return null;
  }

  return formatMetadataValue(value);
};

const eventDisplayNames = {
  "auth.login.failed": "Login Failed",
  "auth.login.success": "Login Success",
  "auth.logout": "Logout",
  "auth.password.changed": "Password Changed",
  "auth.session.revoked": "Session Revoked",
  "role.assigned": "Role Assigned",
  "role.created": "Role Created",
  "role.deleted": "Role Deleted",
  "role.unassigned": "Role Unassigned",
  "role.updated": "Role Updated",
  "user.activated": "User Activated",
  "user.created": "User Created",
  "user.deactivated": "User Deactivated",
  "user.deleted": "User Deleted",
  "user.listed": "Users Listed",
  "user.unlocked": "User Unlocked",
  "user.updated": "User Updated",
  "user.viewed": "User Viewed",
} satisfies Record<string, string>;

export type KnownEventKey = keyof typeof eventDisplayNames;

export const isKnownEvent = (event: string): event is KnownEventKey =>
  Object.hasOwn(eventDisplayNames, event);

const eventBadgeStyles = {
  "auth.login.failed": {
    className:
      "bg-red-600/15 text-red-700 border-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/20",
    variant: "destructive",
  },
  "auth.login.success": {
    className:
      "bg-emerald-600/15 text-emerald-700 border-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20",
    variant: "default",
  },
  "auth.logout": {
    className:
      "bg-slate-600/10 text-slate-600 border-slate-600/15 dark:bg-slate-400/10 dark:text-slate-400 dark:border-slate-400/15",
    variant: "secondary",
  },
  "auth.password.changed": {
    className:
      "bg-amber-600/10 text-amber-700 border-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    variant: "outline",
  },
  "auth.session.revoked": {
    className:
      "bg-orange-600/10 text-orange-700 border-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
    variant: "outline",
  },
  "role.assigned": {
    className:
      "bg-indigo-600/10 text-indigo-700 border-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20",
    variant: "outline",
  },
  "role.created": {
    className:
      "bg-violet-600/15 text-violet-700 border-violet-600/20 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20",
    variant: "default",
  },
  "role.deleted": {
    className:
      "bg-red-600/15 text-red-700 border-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/20",
    variant: "destructive",
  },
  "role.unassigned": {
    className:
      "bg-fuchsia-600/10 text-fuchsia-700 border-fuchsia-600/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:border-fuchsia-500/20",
    variant: "outline",
  },
  "role.updated": {
    className:
      "bg-purple-600/10 text-purple-700 border-purple-600/20 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20",
    variant: "outline",
  },
  "user.activated": {
    className:
      "bg-emerald-600/15 text-emerald-700 border-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20",
    variant: "default",
  },
  "user.created": {
    className:
      "bg-blue-600/15 text-blue-700 border-blue-600/20 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20",
    variant: "default",
  },
  "user.deactivated": {
    className:
      "bg-orange-600/10 text-orange-700 border-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
    variant: "outline",
  },
  "user.deleted": {
    className:
      "bg-red-600/15 text-red-700 border-red-600/20 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/20",
    variant: "destructive",
  },
  "user.listed": {
    className:
      "bg-slate-600/10 text-slate-600 border-slate-600/15 dark:bg-slate-400/10 dark:text-slate-400 dark:border-slate-400/15",
    variant: "secondary",
  },
  "user.unlocked": {
    className:
      "bg-teal-600/10 text-teal-700 border-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/20",
    variant: "outline",
  },
  "user.updated": {
    className:
      "bg-sky-600/10 text-sky-700 border-sky-600/20 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
    variant: "outline",
  },
  "user.viewed": {
    className:
      "bg-slate-600/10 text-slate-600 border-slate-600/15 dark:bg-slate-400/10 dark:text-slate-400 dark:border-slate-400/15",
    variant: "secondary",
  },
} satisfies Record<KnownEventKey, BadgeStyle>;

const defaultBadgeStyle: BadgeStyle = {
  className: "",
  variant: "outline",
};

const eventBadgeDotClassNames = [
  ["emerald", "bg-emerald-500"],
  ["red", "bg-red-500"],
  ["blue", "bg-blue-500"],
  ["amber", "bg-amber-500"],
  ["orange", "bg-orange-500"],
  ["violet", "bg-violet-500"],
  ["purple", "bg-violet-500"],
  ["indigo", "bg-indigo-500"],
  ["sky", "bg-sky-500"],
  ["teal", "bg-teal-500"],
  ["fuchsia", "bg-fuchsia-500"],
  ["slate", "bg-slate-500"],
] as const;

const eventIconNames = {
  "auth.login.failed": "ShieldX",
  "auth.login.success": "LogIn",
  "auth.logout": "LogOut",
  "auth.password.changed": "KeyRound",
  "auth.session.revoked": "ShieldAlert",
  "role.assigned": "ShieldCheck",
  "role.created": "ShieldCheck",
  "role.deleted": "ShieldX",
  "role.unassigned": "ShieldAlert",
  "role.updated": "Shield",
  "user.activated": "UserCheck",
  "user.created": "UserPlus",
  "user.deactivated": "UserX",
  "user.deleted": "UserMinus",
  "user.listed": "List",
  "user.unlocked": "Unlock",
  "user.updated": "UserCog",
  "user.viewed": "Eye",
} as const satisfies Record<KnownEventKey, string>;

export type KnownEventIconName =
  | (typeof eventIconNames)[KnownEventKey]
  | "Activity";

export const getEventDisplayName = (event: string): string =>
  isKnownEvent(event) ? eventDisplayNames[event] : event;

export const getEventBadgeStyle = (event: string): BadgeStyle =>
  isKnownEvent(event) ? eventBadgeStyles[event] : defaultBadgeStyle;

export const getEventBadgeDotClassName = (event: string): string => {
  const badgeClassName = getEventBadgeStyle(event).className;

  for (const [token, dotClassName] of eventBadgeDotClassNames) {
    if (badgeClassName.includes(token)) {
      return dotClassName;
    }
  }

  return "bg-slate-500";
};

export const getEventIconName = (event: string): KnownEventIconName =>
  isKnownEvent(event) ? eventIconNames[event] : "Activity";

const getActorDescription = (actorType: string): string => {
  if (actorType === "system") {
    return "The system";
  }

  if (actorType === "api") {
    return "An API call";
  }

  return "A user";
};

export const getActorTypeLabel = (actorType: string): string => {
  switch (actorType) {
    case "user": {
      return "User";
    }

    case "system": {
      return "System";
    }

    case "api": {
      return "API";
    }

    default: {
      return actorType;
    }
  }
};

export const getTargetTypeLabel = (targetType: string | null): string => {
  if (!targetType) {
    return "N/A";
  }

  switch (targetType) {
    case "user": {
      return "User";
    }

    case "role": {
      return "Role";
    }

    case "session": {
      return "Session";
    }

    default: {
      return targetType;
    }
  }
};

type EventDescriptionBuilder = (
  actor: string,
  metadata: AuditLogMetadata | null
) => string;

const eventDescriptionBuilders = {
  "auth.login.failed": (actor, metadata) => {
    const reason = presentMetadataValueText(metadata?.reason);
    const attempts = presentMetadataValueText(metadata?.attempts);
    const parts = [`${actor} failed to log in`];

    if (reason !== null) {
      parts[0] += ` (${reason.replaceAll("_", " ")})`;
    }

    if (attempts !== null) {
      parts.push(`Attempt #${attempts}`);
    }

    return `${parts.join(". ")}.`;
  },
  "auth.login.success": (actor) => `${actor} successfully logged in.`,
  "auth.logout": (actor) => `${actor} logged out.`,
  "auth.password.changed": (actor) => `${actor} changed the password.`,
  "auth.session.revoked": (actor) => `${actor} revoked a session.`,
  "role.assigned": (actor) => `${actor} changed role assignments.`,
  "role.created": (actor) => `${actor} created a new role.`,
  "role.deleted": (actor) => `${actor} deleted a role.`,
  "role.unassigned": (actor) => `${actor} removed role assignments.`,
  "role.updated": (actor) => `${actor} updated a role.`,
  "user.activated": (actor) => `${actor} activated the user.`,
  "user.created": (actor) => `${actor} created a new user account.`,
  "user.deactivated": (actor, metadata) => {
    const reason = presentMetadataValueText(metadata?.reason);

    return reason === null
      ? `${actor} deactivated the user.`
      : `${actor} deactivated the user. Reason: ${reason}`;
  },
  "user.deleted": (actor) => `${actor} deleted a user account.`,
  "user.listed": (actor) => `${actor} listed users.`,
  "user.unlocked": (actor) => `${actor} unlocked the user account.`,
  "user.updated": (actor) => `${actor} updated user details.`,
  "user.viewed": (actor) => `${actor} viewed user details.`,
} satisfies Record<KnownEventKey, EventDescriptionBuilder>;

export const getEventDescription = (
  event: string,
  actorType: string,
  metadata: AuditLogMetadata | null
): string => {
  const actor = getActorDescription(actorType);

  return isKnownEvent(event)
    ? eventDescriptionBuilders[event](actor, metadata)
    : `${actor} performed "${event}".`;
};

export const ALL_EVENT_TYPES = Object.keys(eventDisplayNames);

export const ALL_TARGET_TYPES = ["user", "role", "session"] as const;
