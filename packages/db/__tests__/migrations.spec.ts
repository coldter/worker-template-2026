import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./helpers/migrate";

const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/app_test";

let client: Client;

beforeAll(async () => {
  client = await runMigrations(TEST_DB_URL);
}, 60_000);

afterAll(async () => {
  if (client) {
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// A1.1 tenant_custom_hostnames
// ---------------------------------------------------------------------------
describe("A1.1 tenant_custom_hostnames", () => {
  it("has all expected columns with correct types", async () => {
    const res = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenant_custom_hostnames'
       ORDER BY ordinal_position`
    );
    const cols = res.rows;
    const col = (name: string) => cols.find((c) => c.column_name === name);

    expect(col("id")).toMatchObject({
      data_type: "character varying",
      is_nullable: "NO",
    });
    expect(col("organization_id")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("hostname")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("cf_hostname_id")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("lifecycle_status")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("cf_status")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("cf_ssl_status")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("verification_errors")).toMatchObject({
      data_type: "jsonb",
      is_nullable: "NO",
    });
    expect(col("verification_token")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("verification_verified_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "YES",
    });
    expect(col("last_reconciled_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "YES",
    });
    expect(col("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
    expect(col("updated_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("has PRIMARY KEY on id", async () => {
    const res = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'tenant_custom_hostnames'
         AND tc.constraint_type = 'PRIMARY KEY'`
    );
    expect(res.rows.map((r) => r.column_name)).toContain("id");
  });

  it("has UNIQUE constraint on hostname", async () => {
    const res = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'tenant_custom_hostnames'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'hostname'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("has UNIQUE constraint on cf_hostname_id", async () => {
    const res = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'tenant_custom_hostnames'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'cf_hostname_id'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("has FK organization_id -> organization.id ON DELETE CASCADE", async () => {
    const res = await client.query(
      `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_name = 'tenant_custom_hostnames'
         AND kcu.column_name = 'organization_id'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].delete_rule).toBe("CASCADE");
  });

  it("has tch_organization_id_idx and tch_status_reconciled_idx indexes", async () => {
    const res = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'tenant_custom_hostnames'`
    );
    const names = res.rows.map((r) => r.indexname);
    expect(names).toContain("tch_organization_id_idx");
    expect(names).toContain("tch_status_reconciled_idx");
  });
});

// ---------------------------------------------------------------------------
// A1.2 sso_providers
// ---------------------------------------------------------------------------
describe("A1.2 sso_providers", () => {
  it("has all expected columns with correct types", async () => {
    const res = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sso_providers'
       ORDER BY ordinal_position`
    );
    const cols = res.rows;
    const col = (name: string) => cols.find((c) => c.column_name === name);

    expect(col("id")).toMatchObject({
      data_type: "character varying",
      is_nullable: "NO",
    });
    expect(col("issuer")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("domain")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("domain_verified")).toMatchObject({
      data_type: "boolean",
      is_nullable: "NO",
    });
    expect(col("oidc_config")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("saml_config")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("user_id")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("provider_id")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("organization_id")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
    expect(col("updated_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("has UNIQUE constraint on provider_id", async () => {
    const res = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'sso_providers'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'provider_id'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("has FK user_id -> users.id ON DELETE SET NULL", async () => {
    const res = await client.query(
      `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_name = 'sso_providers'
         AND kcu.column_name = 'user_id'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].delete_rule).toBe("SET NULL");
  });

  it("has FK organization_id -> organization.id ON DELETE CASCADE", async () => {
    const res = await client.query(
      `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_name = 'sso_providers'
         AND kcu.column_name = 'organization_id'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].delete_rule).toBe("CASCADE");
  });

  it("has ssop_org_id_idx and ssop_domain_idx indexes", async () => {
    const res = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'sso_providers'`
    );
    const names = res.rows.map((r) => r.indexname);
    expect(names).toContain("ssop_org_id_idx");
    expect(names).toContain("ssop_domain_idx");
  });

  it("has no client_secret or client_secret_encrypted column", async () => {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'sso_providers'
         AND column_name IN ('client_secret', 'client_secret_encrypted')`
    );
    expect(res.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A1.3 reserved_slugs
// ---------------------------------------------------------------------------
describe("A1.3 reserved_slugs", () => {
  it("has all expected columns", async () => {
    const res = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reserved_slugs'
       ORDER BY ordinal_position`
    );
    const cols = res.rows;
    const col = (name: string) => cols.find((c) => c.column_name === name);

    expect(col("id")).toMatchObject({
      data_type: "character varying",
      is_nullable: "NO",
    });
    expect(col("slug")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(col("reason")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("kind")).toMatchObject({
      data_type: "text",
      is_nullable: "NO",
    });
    expect(col("organization_id")).toMatchObject({
      data_type: "text",
      is_nullable: "YES",
    });
    expect(col("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("kind column defaults to 'slug' for backwards compatibility (A1i)", async () => {
    const res = await client.query<{ column_default: string | null }>(
      `SELECT column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reserved_slugs'
         AND column_name = 'kind'`
    );
    expect(res.rows[0]?.column_default).toBe("'slug'::text");
  });

  it("has UNIQUE constraint on slug", async () => {
    const res = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'reserved_slugs'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'slug'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("raises unique_violation (23505) on duplicate slug", async () => {
    const id1 = `rsv_test_${Date.now()}_1`;
    const id2 = `rsv_test_${Date.now()}_2`;
    const slug = `test-slug-${Date.now()}`;

    await client.query(
      `INSERT INTO reserved_slugs (id, slug, reason) VALUES ($1, $2, 'tombstoned')`,
      [id1, slug]
    );

    await expect(
      client.query(
        `INSERT INTO reserved_slugs (id, slug, reason) VALUES ($1, $2, 'tombstoned')`,
        [id2, slug]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });
});

// ---------------------------------------------------------------------------
// A1.4 organization columns
// ---------------------------------------------------------------------------
describe("A1.4 organization columns", () => {
  it("has enforce_sso boolean NOT NULL DEFAULT false", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'enforce_sso'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("boolean");
    expect(res.rows[0].is_nullable).toBe("NO");
    expect(res.rows[0].column_default).toBe("false");
  });

  it("has suspended_at timestamptz nullable", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'suspended_at'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("timestamp with time zone");
    expect(res.rows[0].is_nullable).toBe("YES");
  });

  it("has session_version integer NOT NULL DEFAULT 0", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'session_version'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("integer");
    expect(res.rows[0].is_nullable).toBe("NO");
    expect(res.rows[0].column_default).toBe("0");
  });

  it("has branding jsonb NOT NULL", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'branding'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("jsonb");
    expect(res.rows[0].is_nullable).toBe("NO");
  });

  it("has deleted_at timestamptz nullable", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'organization' AND column_name = 'deleted_at'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("timestamp with time zone");
    expect(res.rows[0].is_nullable).toBe("YES");
  });

  it("defaults flow through on insert", async () => {
    const testId = `org_a14_test_${Date.now()}`;
    await client.query(
      `INSERT INTO organization (id, name) VALUES ($1, 'Test Org A14')`,
      [testId]
    );
    const res = await client.query(
      "SELECT enforce_sso, session_version, branding FROM organization WHERE id = $1",
      [testId]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].enforce_sso).toBe(false);
    expect(res.rows[0].session_version).toBe(0);
    expect(res.rows[0].branding).toEqual({});
    // cleanup
    await client.query("DELETE FROM organization WHERE id = $1", [testId]);
  });
});

// ---------------------------------------------------------------------------
// A1.5 audit_logs reshape
// ---------------------------------------------------------------------------
describe("A1.5 audit_logs reshape", () => {
  it("has organization_id varchar(255) nullable", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable, character_maximum_length
       FROM information_schema.columns
       WHERE table_name = 'audit_logs' AND column_name = 'organization_id'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("character varying");
    expect(res.rows[0].is_nullable).toBe("YES");
    expect(res.rows[0].character_maximum_length).toBe(255);
  });

  it("has NO FK on actor_id", async () => {
    const res = await client.query(
      `SELECT rc.constraint_name
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_name = 'audit_logs' AND kcu.column_name = 'actor_id'`
    );
    expect(res.rows).toHaveLength(0);
  });

  it("has audit_logs_actor_type_created_at_idx and audit_logs_org_id_created_at_idx", async () => {
    const res = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs'`
    );
    const names = res.rows.map((r) => r.indexname);
    expect(names).toContain("audit_logs_actor_type_created_at_idx");
    expect(names).toContain("audit_logs_org_id_created_at_idx");
  });

  it("accepts INSERT with non-user actor_id (polymorphic)", async () => {
    const id = `aud_gad_test_${Date.now()}`;
    await expect(
      client.query(
        `INSERT INTO audit_logs (id, event, actor_id, actor_type)
         VALUES ($1, 'user.viewed', 'gad_test123', 'global_admin')`,
        [id]
      )
    ).resolves.toBeDefined();
    // No DELETE cleanup: audit_logs is append-only (trigger installed in A1.6).
  });
});

// ---------------------------------------------------------------------------
// A1.6 audit_logs append-only trigger
// ---------------------------------------------------------------------------
describe("A1.6 audit_logs append-only", () => {
  it("rejects UPDATE with ERRCODE P0001", async () => {
    const id = `aud_trigger_test_${Date.now()}`;
    await client.query(
      `INSERT INTO audit_logs (id, event, actor_type) VALUES ($1, 'user.viewed', 'user')`,
      [id]
    );

    await expect(
      client.query(`UPDATE audit_logs SET event = 'forged' WHERE id = $1`, [id])
    ).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("append-only"),
    });
  });

  it("rejects DELETE with ERRCODE P0001", async () => {
    const id = `aud_trigger_del_${Date.now()}`;
    await client.query(
      `INSERT INTO audit_logs (id, event, actor_type) VALUES ($1, 'user.viewed', 'user')`,
      [id]
    );

    await expect(
      client.query("DELETE FROM audit_logs WHERE id = $1", [id])
    ).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("append-only"),
    });
  });

  it("INSERT still succeeds after trigger is installed", async () => {
    const id = `aud_insert_ok_${Date.now()}`;
    await expect(
      client.query(
        `INSERT INTO audit_logs (id, event, actor_type) VALUES ($1, 'user.listed', 'user')`,
        [id]
      )
    ).resolves.toBeDefined();
  });

  it("trigger audit_logs_no_mutation_trigger exists on audit_logs", async () => {
    const res = await client.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal`
    );
    const names = res.rows.map((r) => r.tgname);
    expect(names).toContain("audit_logs_no_mutation_trigger");
  });
});

// ---------------------------------------------------------------------------
// A1.7 pgcrypto sso encryption
// ---------------------------------------------------------------------------
describe("A1.7 pgcrypto sso encryption", () => {
  it("pgcrypto extension is present", async () => {
    const res = await client.query(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("sso_providers has oidc_config_encrypted bytea nullable", async () => {
    const res = await client.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'sso_providers' AND column_name = 'oidc_config_encrypted'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("bytea");
    expect(res.rows[0].is_nullable).toBe("YES");
  });

  it("sso_providers still has plain oidc_config text column", async () => {
    const res = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'sso_providers' AND column_name = 'oidc_config'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].data_type).toBe("text");
  });

  it("sso_providers_decrypted view exists", async () => {
    const res = await client.query(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = 'public' AND table_name = 'sso_providers_decrypted'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("encrypt roundtrip with SET LOCAL inside a transaction", async () => {
    // Mirrors the production contract (D13/D73): withDecryptedSecret() opens a
    // transaction and uses SET LOCAL so the GUC is scoped to the txn only.
    const oidcJson = JSON.stringify({ clientId: "abc", clientSecret: "shh" });
    const id = `sso_enc_test_${Date.now()}`;

    await client.query("BEGIN");
    await client.query(`SET LOCAL app.sso_key = 'test-key'`);
    await client.query(
      `INSERT INTO sso_providers (id, issuer, domain, provider_id, oidc_config_encrypted)
       VALUES ($1, 'https://issuer.example', 'example.com', $2, pgp_sym_encrypt($3, 'test-key'))`,
      [id, `pid_${id}`, oidcJson]
    );
    const res = await client.query(
      "SELECT oidc_config FROM sso_providers_decrypted WHERE id = $1",
      [id]
    );
    await client.query("COMMIT");

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].oidc_config).toBe(oidcJson);
  });

  it("decrypted view raises error when app.sso_key GUC is unset", async () => {
    // Pre-seed an encrypted row inside a transaction (key cleared by COMMIT).
    const id = `sso_nokey_test_${Date.now()}`;
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.sso_key = 'somekey'`);
    await client.query(
      `INSERT INTO sso_providers (id, issuer, domain, provider_id, oidc_config_encrypted)
       VALUES ($1, 'https://issuer2.example', 'example2.com', $2, pgp_sym_encrypt('{"clientId":"x"}', current_setting('app.sso_key')))`,
      [id, `pid_nokey_${id}`]
    );
    await client.query("COMMIT");

    // Read on a fresh connection with no GUC set — must fail, not return NULL.
    const freshClient = new Client({ connectionString: TEST_DB_URL });
    await freshClient.connect();
    await expect(
      freshClient.query(
        "SELECT oidc_config FROM sso_providers_decrypted WHERE id = $1",
        [id]
      )
    ).rejects.toBeDefined();
    await freshClient.end();
  });
});

// ---------------------------------------------------------------------------
// A1.8 invitations.inviter_id nullable
// ---------------------------------------------------------------------------
describe("A1.8 invitations.inviter_id nullable", () => {
  it("inviter_id is nullable in information_schema", async () => {
    const res = await client.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'invitation' AND column_name = 'inviter_id'`
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].is_nullable).toBe("YES");
  });

  it("allows INSERT with inviter_id = NULL", async () => {
    // First insert an org so FK on organization_id works
    const orgId = `org_inv_test_${Date.now()}`;
    await client.query(
      `INSERT INTO organization (id, name) VALUES ($1, 'Inv Test Org')`,
      [orgId]
    );

    const invId = `inv_test_${Date.now()}`;
    await expect(
      client.query(
        `INSERT INTO invitation (id, email, organization_id, role, status, expires_at)
         VALUES ($1, 'test@example.com', $2, 'member', 'pending', now() + interval '7 days')`,
        [invId, orgId]
      )
    ).resolves.toBeDefined();

    // cleanup
    await client.query("DELETE FROM invitation WHERE id = $1", [invId]);
    await client.query("DELETE FROM organization WHERE id = $1", [orgId]);
  });
});

// ---------------------------------------------------------------------------
// member.role / invitation.role CHECK constraints (role_check_constraints)
// ---------------------------------------------------------------------------
describe("member.role and invitation.role CHECK constraints", () => {
  it("member_role_check is registered on the member table", async () => {
    const res = await client.query<{ constraint_name: string }>(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE table_name = 'member'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'member_role_check'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("invitation_role_check is registered on the invitation table", async () => {
    const res = await client.query<{ constraint_name: string }>(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE table_name = 'invitation'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'invitation_role_check'`
    );
    expect(res.rows).toHaveLength(1);
  });

  it("rejects member rows with unknown role", async () => {
    const orgId = `org_chk_${Date.now()}`;
    const userId = `usr_chk_${Date.now()}`;
    await client.query(
      `INSERT INTO organization (id, name) VALUES ($1, 'CheckOrg')`,
      [orgId]
    );
    await client.query(
      `INSERT INTO users (id, name, email)
       VALUES ($1, 'Check User', $2)`,
      [userId, `chk_${Date.now()}@example.com`]
    );

    const memberId = `mem_chk_${Date.now()}`;
    await expect(
      client.query(
        `INSERT INTO member (id, user_id, organization_id, role)
         VALUES ($1, $2, $3, 'wizard')`,
        [memberId, userId, orgId]
      )
    ).rejects.toMatchObject({ code: "23514" });

    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("DELETE FROM organization WHERE id = $1", [orgId]);
  });

  it("accepts member rows with canonical roles", async () => {
    const orgId = `org_chk_ok_${Date.now()}`;
    const userId = `usr_chk_ok_${Date.now()}`;
    await client.query(
      `INSERT INTO organization (id, name) VALUES ($1, 'CheckOkOrg')`,
      [orgId]
    );
    await client.query(
      `INSERT INTO users (id, name, email)
       VALUES ($1, 'Ok User', $2)`,
      [userId, `chkok_${Date.now()}@example.com`]
    );

    for (const role of ["owner", "admin", "member"]) {
      const memberId = `mem_chk_ok_${role}_${Date.now()}`;
      await expect(
        client.query(
          `INSERT INTO member (id, user_id, organization_id, role)
           VALUES ($1, $2, $3, $4)`,
          [memberId, userId, orgId, role]
        )
      ).resolves.toBeDefined();
      await client.query("DELETE FROM member WHERE id = $1", [memberId]);
    }

    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("DELETE FROM organization WHERE id = $1", [orgId]);
  });

  it("rejects invitation rows with unknown role", async () => {
    const orgId = `org_inv_chk_${Date.now()}`;
    await client.query(
      `INSERT INTO organization (id, name) VALUES ($1, 'InvCheckOrg')`,
      [orgId]
    );
    const invId = `inv_chk_${Date.now()}`;
    await expect(
      client.query(
        `INSERT INTO invitation (id, email, organization_id, role, status, expires_at)
         VALUES ($1, 'x@example.com', $2, 'wizard', 'pending', now() + interval '1 day')`,
        [invId, orgId]
      )
    ).rejects.toMatchObject({ code: "23514" });
    await client.query("DELETE FROM organization WHERE id = $1", [orgId]);
  });
});
