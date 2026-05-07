import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { createdAt, updatedAt } from "./columns";

/**
 * Operators of the platform (B1 / D20). Stateless: identity is asserted by
 * Cloudflare Access JWT (D19/D26); this table only records who is allowed
 * through that gate, their role, and lifecycle metadata. Distinct from
 * `users` so tenant accounts and platform operators cannot collide.
 *
 * The `cf_access_sub` column is bound on first successful login via the
 * enrollment-token flow (D31) and uniqueness-enforced.
 */
export const globalAdmins = pgTable(
  "global_admins",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.globalAdmin)),
    email: text("email").notNull().unique(),
    cfAccessSub: text("cf_access_sub").unique(),
    name: text("name").notNull(),
    role: text("role", {
      enum: ["super_admin", "support", "read_only", "security"],
    }).notNull(),
    enrollmentToken: text("enrollment_token").unique(),
    enrollmentTokenExpiresAt: timestamp("enrollment_token_expires_at", {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: varchar("created_by", { length: 255 }).references(
      (): AnyPgColumn => globalAdmins.id,
      { onDelete: "set null" }
    ),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedBy: varchar("deactivated_by", { length: 255 }).references(
      (): AnyPgColumn => globalAdmins.id,
      { onDelete: "set null" }
    ),
    deactivatedReason: text("deactivated_reason"),
  },
  (t) => [
    index("global_admins_active_email_idx")
      .on(t.email)
      .where(sql`${t.deactivatedAt} IS NULL`),
    index("global_admins_role_idx").on(t.role),
  ]
);

export type GlobalAdmin = typeof globalAdmins.$inferSelect;
export type NewGlobalAdmin = typeof globalAdmins.$inferInsert;
