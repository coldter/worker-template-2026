import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { createdAt, updatedAt } from "./columns";
import { organizations } from "./organizations";

// A5 lifecycle states (D5 / D74). Internal lifecycle is decoupled from raw
// Cloudflare-for-SaaS surface so CF surface changes do not leak into our
// state machine.
export const customHostnameLifecycle = [
  "pending_txt",
  "awaiting_cf",
  "pre_validation",
  "active",
  "failed",
  "removing",
  "removed",
] as const;

export type CustomHostnameLifecycle = (typeof customHostnameLifecycle)[number];

export const tenantCustomHostnames = pgTable(
  "tenant_custom_hostnames",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.tenantHostname)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    cfHostnameId: text("cf_hostname_id").unique(),
    lifecycleStatus: text("lifecycle_status", {
      enum: customHostnameLifecycle,
    })
      .notNull()
      .default("pending_txt"),
    cfStatus: text("cf_status"),
    cfSslStatus: text("cf_ssl_status"),
    verificationErrors: jsonb("verification_errors")
      .$type<string[]>()
      .notNull()
      .default([]),
    verificationToken: text("verification_token").notNull(),
    verificationVerifiedAt: timestamp("verification_verified_at", {
      withTimezone: true,
    }),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    lastCfPolledAt: timestamp("last_cf_polled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tch_organization_id_idx").on(t.organizationId),
    index("tch_status_reconciled_idx").on(
      t.lifecycleStatus,
      t.lastReconciledAt
    ),
  ]
);

export type TenantCustomHostname = typeof tenantCustomHostnames.$inferSelect;
export type NewTenantCustomHostname = typeof tenantCustomHostnames.$inferInsert;
