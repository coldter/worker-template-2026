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
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.user)),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps(),
    status: text("status")
      .$type<"active" | "inactive" | "locked" | "deleted">()
      .default("active")
      .notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    // AnyPgColumn cast breaks the circular self-FK type inference.
    deactivatedBy: varchar("deactivated_by", { length: 255 }).references(
      (): AnyPgColumn => users.id,
      { onDelete: "set null" }
    ),
    deactivatedReason: text("deactivated_reason"),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    roleSlugs: text("role_slugs").array().default([]).notNull(),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  },
  (table) => [
    check(
      "users_status_check",
      sql`${table.status} in ('active', 'inactive', 'locked', 'deleted')`
    ),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.session)),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ...timestamps(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["web", "mobile"] }).default("web"),
    activeOrganizationId: text("active_organization_id"),
    activeOrgRole: text("active_org_role"),
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
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.account)),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)]
);

export const verifications = pgTable(
  "verifications",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.verification)),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);

export const jwkss = pgTable("jwks", {
  id: varchar("id", { length: 255 })
    .primaryKey()
    .$defaultFn(() => generatePrefixedCuid("jwk")),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  // Intentionally immutable, no updatedAt: rotation inserts new rows.
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const twoFactors = pgTable(
  "two_factors",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid("2fa")),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Required by better-auth twoFactor plugin schema; unused in our email-OTP-only flow.
    secret: text("secret"),
    backupCodes: text("backup_codes"),
    ...timestamps(),
  },
  (table) => [index("two_factors_user_id_idx").on(table.userId)]
);
