import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Branding is a deferred-shape blob in Phase A. B6 fills the full schema
// (logo upload + R2 versioning). The structural type is widened here so the
// `/api/tenancy/current` response (D78) can read fields that B6 will
// populate. All fields stay optional so writers can land partials today.
export type TenantBranding = {
  logoUrl?: string;
  primaryColor?: string;
  appName?: string;
  // logoVersion is a unix-ms stamp written by B6 on logo upload. Phase A
  // reads it as null when absent (no logo uploaded yet).
  logoVersion?: number;
  // logoExt is the persisted extension (png/webp/svg) for the uploaded logo
  // and is used to compute the final CDN URL in `/api/tenancy/current`.
  logoExt?: string;
};

export const organizations = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  // Multi-tenancy columns use timestamptz so all persisted instants are UTC.
  enforceSSO: boolean("enforce_sso").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedBy: varchar("suspended_by", { length: 255 }),
  suspendedReason: text("suspended_reason"),
  // `deletedAt` carries timezone info to stay consistent with the other
  // audit-style timestamps on the row (createdAt + audit_logs.created_at).
  // Run `bun run db:generate` to materialize the migration before merge.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: varchar("deleted_by", { length: 255 }),
  sessionVersion: integer("session_version").notNull().default(0),
  branding: jsonb("branding")
    .$type<TenantBranding>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});

export const members = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("member_user_id_idx").on(t.userId),
    index("member_org_id_idx").on(t.organizationId),
  ]
);

export const invitations = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    inviterId: text("inviter_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("invitation_org_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ]
);
