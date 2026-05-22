import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, timestamps } from "../helpers";
import { users } from "./auth";

export const organizations = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  ...timestamps(),
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
    ...timestamps(),
  },
  (table) => [
    index("member_user_id_idx").on(table.userId),
    index("member_org_id_idx").on(table.organizationId),
    uniqueIndex("members_user_org_unique").on(
      table.userId,
      table.organizationId
    ),
  ]
);

export const invitations = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Intentionally immutable, no updatedAt: terminal-write only.
    createdAt: createdAt(),
  },
  (t) => [
    index("invitation_org_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ]
);
