import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { createdAt } from "./columns";
import { organizations } from "./organizations";

export const reservedSlugs = pgTable("reserved_slugs", {
  id: varchar("id", { length: 255 })
    .primaryKey()
    .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.reservedSlug)),
  slug: text("slug").notNull().unique(),
  // Discriminator added in A1i so the same string can never collide between
  // a tenant slug tombstone and a custom-hostname tombstone, and so the
  // request handler can scope its lookup (slug vs apex) to the relevant
  // category. Defaults to "slug" so prior callers behave identically.
  kind: text("kind", { enum: ["slug", "hostname"] })
    .notNull()
    .default("slug"),
  reason: text("reason", {
    enum: ["tombstoned", "manual", "system", "deleted_org"],
  }).notNull(),
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export type ReservedSlug = typeof reservedSlugs.$inferSelect;
export type NewReservedSlug = typeof reservedSlugs.$inferInsert;
