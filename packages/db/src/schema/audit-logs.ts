import type {
  ActorType,
  AuditEventKey,
  AuditLogMetadata,
  TargetType,
} from "@repo/shared/audit";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.auditLog)),

    event: text("event").$type<AuditEventKey>().notNull(),

    // Polymorphic actor: may hold users.id (usr_*), global_admins.id (gad_*), or NULL for system.
    // FK deliberately omitted — see D30; actor_id must remain writable after user hard-delete.
    actorId: varchar("actor_id", { length: 255 }),
    actorType: text("actor_type").$type<ActorType>().default("user").notNull(),

    // Tenant scope — nullable so global-scope rows (organizationId IS NULL) remain expressible.
    // FK deliberately omitted — audit rows must survive tenant hard-delete.
    organizationId: varchar("organization_id", { length: 255 }),

    targetId: varchar("target_id", { length: 255 }),
    targetType: text("target_type").$type<TargetType>(),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    metadata: jsonb("metadata").$type<AuditLogMetadata>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_event_idx").on(table.event),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_target_idx").on(table.targetId, table.targetType),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_type_created_at_idx").on(
      table.actorType,
      table.createdAt.desc()
    ),
    index("audit_logs_org_id_created_at_idx").on(
      table.organizationId,
      table.createdAt.desc()
    ),
    // Composite index for the per-tenant audit-log filter UI: lists rows for
    // one organization filtered by `event` and ordered by recency. Run
    // `bun run db:generate` to materialize the migration before merge.
    index("audit_logs_org_event_created_at_idx").on(
      table.organizationId,
      table.event,
      table.createdAt.desc()
    ),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
