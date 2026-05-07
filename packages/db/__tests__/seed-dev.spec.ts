// A7.3 — seed-dev contract. Runs against a real Postgres at
// `DATABASE_TEST_URL` with all migrations applied, asserts:
//   (a) one run produces org + user + member + (optional) custom hostname
//   (b) a second run is a no-op (idempotent)
//   (c) `DEFAULT_DEV_CUSTOM_HOST` upserts an active tenant_custom_hostnames row
//
// Imports the script via a relative path because the script lives outside
// the workspace and is normally invoked from `apps/server`'s cwd. This test
// wires the same module from a workspace that already has all deps.

import { scrypt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-parent-imports
import { type SeedDevEnv, seedDev } from "../../../scripts/seed-dev";
import { createDrizzleClient } from "../src/client";
import {
  members,
  organizations,
  tenantCustomHostnames,
  users,
} from "../src/schema";
import { runMigrations } from "./helpers/migrate";

const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/app_test";

const SCRYPT_ENVELOPE_RE = /^[0-9a-f]+:[0-9a-f]+$/;

let client: Client;

beforeAll(async () => {
  client = await runMigrations(TEST_DB_URL);
}, 60_000);

afterAll(async () => {
  if (client) {
    await client.end();
  }
});

const baseEnv: SeedDevEnv = {
  defaultDevTenantSlug: "acme",
  localDevTenantEmail: "owner@acme.test",
  localDevTenantPassword: "changeme123",
  defaultDevCustomHost: "",
};

describe("seedDev (Phase A baseline)", () => {
  it("creates org + user + owner member when none exist", async () => {
    const db = createDrizzleClient(client);
    const result = await seedDev(db, baseEnv);
    expect(result.organizationId).toBeTruthy();
    expect(result.userId).toBeTruthy();
    expect(result.customHostnameId).toBeNull();

    const orgRows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, "acme"));
    expect(orgRows[0]?.id).toBe(result.organizationId);

    const userRows = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, "owner@acme.test"));
    expect(userRows[0]?.emailVerified).toBe(true);

    const memberRows = await db
      .select({ role: members.role })
      .from(members)
      .where(eq(members.userId, result.userId));
    expect(memberRows[0]?.role).toBe("owner");
  });

  it("is idempotent across two runs", async () => {
    const db = createDrizzleClient(client);
    const a = await seedDev(db, baseEnv);
    const b = await seedDev(db, baseEnv);
    expect(b.organizationId).toBe(a.organizationId);
    expect(b.userId).toBe(a.userId);
    const orgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, "acme"));
    expect(orgs).toHaveLength(1);
    const usrs = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "owner@acme.test"));
    expect(usrs).toHaveLength(1);
  });

  it("writes a scrypt envelope on accounts.password that re-derives to the same key", async () => {
    // The seeded password envelope is `<saltHex>:<keyHex>` where the key is
    // produced by Node's scrypt with N=16384 r=16 p=1 dkLen=64 — the same
    // shape Better Auth's email/password adapter expects. Re-derive using
    // the parsed salt and assert the resulting envelope matches.
    const db = createDrizzleClient(client);
    await seedDev(db, baseEnv);
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "owner@acme.test"));
    const userId = userRows[0]?.id;
    expect(userId).toBeTruthy();

    const passwordRows = await db.execute<{ password: string | null }>(
      sql`SELECT password FROM accounts WHERE user_id = ${userId} AND provider_id = 'credential' LIMIT 1`
    );
    const stored = passwordRows.rows[0]?.password ?? "";
    expect(stored).toMatch(SCRYPT_ENVELOPE_RE);
    const [saltHex, keyHex] = stored.split(":");
    expect(saltHex).toBeTruthy();
    expect(keyHex).toBeTruthy();

    const derived = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        baseEnv.localDevTenantPassword.normalize("NFKC"),
        saltHex ?? "",
        64,
        { N: 16_384, r: 16, p: 1, maxmem: 128 * 16_384 * 16 * 2 },
        (err, key) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(key);
        }
      );
    });
    expect(derived.toString("hex")).toBe(keyHex);
  });

  it("upserts an active custom hostname when DEFAULT_DEV_CUSTOM_HOST is set", async () => {
    const db = createDrizzleClient(client);
    const env: SeedDevEnv = {
      ...baseEnv,
      defaultDevCustomHost: "acme.local.test",
    };
    const result = await seedDev(db, env);
    expect(result.customHostnameId).toBeTruthy();
    const rows = await db
      .select({
        lifecycleStatus: tenantCustomHostnames.lifecycleStatus,
        cfStatus: tenantCustomHostnames.cfStatus,
        organizationId: tenantCustomHostnames.organizationId,
      })
      .from(tenantCustomHostnames)
      .where(eq(tenantCustomHostnames.hostname, "acme.local.test"));
    const row = rows[0];
    expect(row?.lifecycleStatus).toBe("active");
    expect(row?.cfStatus).toBe("active");
    expect(row?.organizationId).toBe(result.organizationId);
  });
});
