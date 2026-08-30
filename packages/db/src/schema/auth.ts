import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, timestamps } from "../helpers";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";

export const users = pgTable(
  "users",
  {
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.user)),
    image: text("image"),
    name: text("name").notNull(),
    ...timestamps(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    // AnyPgColumn cast breaks the circular self-FK type inference.
    deactivatedBy: varchar("deactivated_by", { length: 255 }).references(
      (): AnyPgColumn => users.id,
      { onDelete: "set null" }
    ),
    deactivatedReason: text("deactivated_reason"),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    roleSlugs: text("role_slugs").array().default([]).notNull(),
    status: text("status")
      .$type<"active" | "inactive" | "locked" | "deleted">()
      .default("active")
      .notNull(),
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  },
  (table) => [
    check(
      "users_status_check",
      sql`${table.status} in ('active', 'inactive', 'locked', 'deleted')`
    ),
    index("users_created_at_idx").on(table.createdAt),
    index("users_status_idx").on(table.status),
    index("users_role_slugs_idx").using("gin", table.roleSlugs),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.session)),
    token: text("token").notNull().unique(),
    ...timestamps(),
    activeOrganizationId: text("active_organization_id"),
    activeOrgRole: text("active_org_role"),
    ipAddress: text("ip_address"),
    platform: text("platform", { enum: ["web", "mobile"] }).default("web"),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    check(
      "sessions_platform_check",
      sql`${table.platform} in ('web', 'mobile')`
    ),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    accountId: text("account_id").notNull(),
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.account)),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)]
);

export const verifications = pgTable(
  "verifications",
  {
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.verification)),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    ...timestamps(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);

export const jwkss = pgTable("jwks", {
  // Intentionally immutable, no updatedAt: rotation inserts new rows.
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  id: varchar("id", { length: 255 })
    .primaryKey()
    .$defaultFn(() => generatePrefixedCuid("jwk")),
  privateKey: text("private_key").notNull(),
  publicKey: text("public_key").notNull(),
});

export const twoFactors = pgTable(
  "two_factors",
  {
    backupCodes: text("backup_codes"),
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid("2fa")),
    // Required by better-auth twoFactor plugin schema; unused in our email-OTP-only flow.
    secret: text("secret"),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [index("two_factors_user_id_idx").on(table.userId)]
);
