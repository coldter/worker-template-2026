#!/usr/bin/env bun
// A7.3 — Phase A baseline seed. Idempotent. Provisions a single dev tenant
// (org + owner user + member row) so the local harness can resolve
// `https://{slug}.app.lvh.me` end-to-end. When `DEFAULT_DEV_CUSTOM_HOST` is
// set, also writes an `active` `tenant_custom_hostnames` row so tenant
// resolution can hit the custom-host branch without a real CF round-trip.

// Run from a context that has @repo/db resolvable in node_modules. Bun
// resolves workspace packages from the cwd, so:
//   bun --cwd apps/server ../../scripts/seed-dev.ts
// works without needing scripts/ to be a workspace member. The script-level
// `bun run seed:dev` wraps that command.
//
// Password hashing uses Node's scrypt with the same envelope shape Better
// Auth uses (`<salt>:<key>` hex), so the resulting `accounts.password`
// row verifies under BA's email/password adapter without further work.
// Reference: @better-auth/utils/password.node — scrypt N=16384 r=16 p=1.

import { randomBytes, scrypt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  type DrizzleClient,
  members,
  organizations,
  tenantCustomHostnames,
  users,
  withDrizzleClient,
} from "../packages/db/src";

export type SeedDevEnv = Readonly<{
  defaultDevTenantSlug: string;
  localDevTenantEmail: string;
  localDevTenantPassword: string;
  // Optional. When set, an `active` `tenant_custom_hostnames` row is upserted.
  defaultDevCustomHost?: string;
}>;

export type SeedDevResult = Readonly<{
  organizationId: string;
  userId: string;
  customHostnameId: string | null;
}>;

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`seed-dev: required env var ${name} is missing`);
  }
  return value;
}

export function loadSeedDevEnv(env: NodeJS.ProcessEnv): SeedDevEnv {
  return {
    defaultDevTenantSlug: envOrThrow("DEFAULT_DEV_TENANT_SLUG"),
    localDevTenantEmail: envOrThrow("LOCAL_DEV_TENANT_EMAIL"),
    localDevTenantPassword: envOrThrow("LOCAL_DEV_TENANT_PASSWORD"),
    defaultDevCustomHost: env.DEFAULT_DEV_CUSTOM_HOST ?? "",
  };
}

const ORG_ID_PREFIX = "org";
const MEMBER_ID_PREFIX = "mbr";

const SCRYPT_CONFIG = Object.freeze({
  N: 16_384,
  r: 16,
  p: 1,
  dkLen: 64,
});

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      SCRYPT_CONFIG.dkLen,
      {
        N: SCRYPT_CONFIG.N,
        r: SCRYPT_CONFIG.r,
        p: SCRYPT_CONFIG.p,
        maxmem: 128 * SCRYPT_CONFIG.N * SCRYPT_CONFIG.r * 2,
      },
      (err, key) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(key);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

function newId(prefix: string): string {
  const seconds = Math.floor(Date.now() / 1000).toString(16);
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  const hex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${seconds}${hex}`;
}

export async function seedDev(
  db: DrizzleClient,
  env: SeedDevEnv
): Promise<SeedDevResult> {
  const slug = env.defaultDevTenantSlug;

  // Org — idempotent on slug.
  const existingOrgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const existingOrg = existingOrgRows[0];
  let organizationId: string;
  if (existingOrg) {
    organizationId = existingOrg.id;
  } else {
    organizationId = newId(ORG_ID_PREFIX);
    await db.insert(organizations).values({
      id: organizationId,
      name: slug,
      slug,
    });
  }

  // Owner user — idempotent on email.
  const existingUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.localDevTenantEmail))
    .limit(1);
  const existingUser = existingUserRows[0];
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const hashed = await hashPassword(env.localDevTenantPassword);
    const [created] = await db
      .insert(users)
      .values({
        name: slug,
        email: env.localDevTenantEmail,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (!created) {
      throw new Error("seed-dev: insert user returned no rows");
    }
    userId = created.id;
    // Better Auth's email/password adapter stores hashed passwords on the
    // `accounts` table with `providerId = "credential"`. Using a raw SQL
    // insert here keeps the script independent of BA's runtime; the script
    // only runs against an empty dev DB so the FK + unique constraints make
    // the operation safe.
    await db.execute(sql`
      INSERT INTO accounts (id, account_id, provider_id, user_id, password)
      VALUES (
        ${`acc_${userId}`},
        ${userId},
        'credential',
        ${userId},
        ${hashed}
      )
      ON CONFLICT DO NOTHING
    `);
  }

  // Member — idempotent on (userId, organizationId).
  const existingMemberRows = await db
    .select({ id: members.id })
    .from(members)
    .where(
      sql`${members.userId} = ${userId} AND ${members.organizationId} = ${organizationId}`
    )
    .limit(1);
  const existingMember = existingMemberRows[0];
  if (!existingMember) {
    await db.insert(members).values({
      id: newId(MEMBER_ID_PREFIX),
      userId,
      organizationId,
      role: "owner",
    });
  }

  // Optional custom hostname.
  let customHostnameId: string | null = null;
  if (env.defaultDevCustomHost && env.defaultDevCustomHost.length > 0) {
    const host = env.defaultDevCustomHost;
    const existingHostRows = await db
      .select({ id: tenantCustomHostnames.id })
      .from(tenantCustomHostnames)
      .where(eq(tenantCustomHostnames.hostname, host))
      .limit(1);
    const existingHost = existingHostRows[0];
    if (existingHost) {
      customHostnameId = existingHost.id;
    } else {
      const [createdHost] = await db
        .insert(tenantCustomHostnames)
        .values({
          organizationId,
          hostname: host,
          lifecycleStatus: "active",
          cfStatus: "active",
          verificationToken: "dev-seed-token",
          verificationVerifiedAt: new Date(),
        })
        .returning({ id: tenantCustomHostnames.id });
      if (!createdHost) {
        throw new Error(
          "seed-dev: insert tenant_custom_hostnames returned no rows"
        );
      }
      customHostnameId = createdHost.id;
    }
  }

  return { organizationId, userId, customHostnameId };
}

if (import.meta.main) {
  const env = loadSeedDevEnv(process.env);
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/app_dev";
  const result = await withDrizzleClient(
    connectionString,
    async (db) => await seedDev(db, env)
  );
  process.stdout.write(
    `seed-dev OK org=${result.organizationId} user=${result.userId} customHost=${result.customHostnameId ?? "(none)"}\n`
  );
}
