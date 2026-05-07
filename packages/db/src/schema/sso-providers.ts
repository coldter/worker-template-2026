import {
  boolean,
  bytea,
  index,
  pgTable,
  pgView,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { users } from "./auth";
import { createdAt, updatedAt } from "./columns";
import { organizations } from "./organizations";

export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.ssoProvider)),
    issuer: text("issuer").notNull(),
    domain: text("domain").notNull(),
    domainVerified: boolean("domain_verified").notNull().default(false),
    oidcConfig: text("oidc_config"),
    oidcConfigEncrypted: bytea("oidc_config_encrypted"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ssop_org_id_idx").on(t.organizationId),
    index("ssop_domain_idx").on(t.domain),
  ]
);

export type SsoProvider = typeof ssoProviders.$inferSelect;
export type NewSsoProvider = typeof ssoProviders.$inferInsert;

// The decrypted view is created by the a1g migration (hand-edited SQL).
// .existing() tells Drizzle not to emit DDL for this view.
export const ssoProvidersDecrypted = pgView("sso_providers_decrypted", {
  id: varchar("id", { length: 255 }).notNull(),
  issuer: text("issuer").notNull(),
  domain: text("domain").notNull(),
  domainVerified: boolean("domain_verified").notNull(),
  oidcConfig: text("oidc_config"),
  samlConfig: text("saml_config"),
  userId: text("user_id"),
  providerId: text("provider_id").notNull(),
  organizationId: text("organization_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).existing();
