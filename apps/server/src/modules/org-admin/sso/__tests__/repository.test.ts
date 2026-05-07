import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

import { ssoProviderRepository } from "../repository";

const SECRET_KEY_RE = /secret/i;
const PGP_SYM_ENCRYPT_RE = /pgp_sym_encrypt/;
const CURRENT_SETTING_SSO_KEY_RE = /current_setting\('app\.sso_key'\)/;

type SelectChain = {
  from: (table: unknown) => {
    where: (predicate: unknown) => Promise<Record<string, unknown>[]>;
  };
};

describe("ssoProviderRepository — read paths exclude plaintext", () => {
  it("findByOrg returns rows without oidcConfigEncrypted, oidcConfig, or any *secret* field", async () => {
    const captured: { columns?: Record<string, unknown> } = {};
    const fakeRow = {
      id: "p1",
      organizationId: "o1",
      providerId: "okta",
      issuer: "https://idp",
      domain: "acme.com",
      domainVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      select: (columns: Record<string, unknown>): SelectChain => {
        captured.columns = columns;
        return {
          from: () => ({
            where: async () => [fakeRow],
          }),
        };
      },
    };

    // boundary: vendor-SDK generic variance — Drizzle's DrizzleClient is a complex
    // generic type; this test fixture provides only the methods exercised.
    const rows = await ssoProviderRepository.findByOrg(
      db as unknown as Parameters<typeof ssoProviderRepository.findByOrg>[0],
      "o1"
    );
    expect(rows).toHaveLength(1);
    for (const r of rows) {
      const keys = Object.keys(r);
      expect(keys).not.toContain("oidcConfigEncrypted");
      expect(keys).not.toContain("oidcConfig");
      expect(keys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);
    }
    // Verify the column projection used in select() also excludes secret material.
    const projectedKeys = Object.keys(captured.columns ?? {});
    expect(projectedKeys).not.toContain("oidcConfigEncrypted");
    expect(projectedKeys).not.toContain("oidcConfig");
    expect(projectedKeys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);
  });

  it("findById likewise excludes secret material", async () => {
    const captured: { columns?: Record<string, unknown> } = {};
    const fakeRow = {
      id: "p1",
      organizationId: "o1",
      providerId: "okta",
      issuer: "https://idp",
      domain: "acme.com",
      domainVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      select: (columns: Record<string, unknown>) => {
        captured.columns = columns;
        return {
          from: () => ({
            where: () => ({
              limit: async () => [fakeRow],
            }),
          }),
        };
      },
    };
    const row = await ssoProviderRepository.findById(
      db as unknown as Parameters<typeof ssoProviderRepository.findById>[0],
      "o1",
      "p1"
    );
    if (!row) {
      throw new Error("expected a row");
    }
    const keys = Object.keys(row);
    expect(keys).not.toContain("oidcConfigEncrypted");
    expect(keys).not.toContain("oidcConfig");
    expect(keys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);
    const projectedKeys = Object.keys(captured.columns ?? {});
    expect(projectedKeys).not.toContain("oidcConfigEncrypted");
    expect(projectedKeys).not.toContain("oidcConfig");
    expect(projectedKeys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);
  });

  it("findById returns null when no row matches", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    const row = await ssoProviderRepository.findById(
      db as unknown as Parameters<typeof ssoProviderRepository.findById>[0],
      "o1",
      "missing"
    );
    expect(row).toBeNull();
  });
});

function sqlToText(query: unknown): string {
  return JSON.stringify(query);
}

describe("ssoProviderRepository — write paths encrypt", () => {
  it("create() inserts oidc_config_encrypted via pgp_sym_encrypt and returns only public columns", async () => {
    const captured: { values?: Record<string, unknown>; returning?: unknown } =
      {};
    const insertedRow = {
      id: "ssop_new",
      issuer: "https://idp",
      domain: "acme.com",
      providerId: "okta",
      organizationId: "org_acme",
      domainVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          captured.values = vals;
          return {
            returning: (cols: unknown) => {
              captured.returning = cols;
              return Promise.resolve([insertedRow]);
            },
          };
        },
      }),
    };

    const result = await ssoProviderRepository.create(
      // boundary: vendor-SDK generic variance — Transaction is deeply generic.
      tx as unknown as Parameters<typeof ssoProviderRepository.create>[0],
      {
        issuer: "https://idp",
        domain: "acme.com",
        providerId: "okta",
        organizationId: "org_acme",
        userId: "u1",
        oidcConfig: {
          clientId: "cid",
          clientSecret: "shh",
        },
      }
    );

    // The values blob must include an encrypted column expression — never the
    // plaintext oidcConfig as a stored field.
    expect(captured.values).toBeDefined();
    const valueKeys = Object.keys(captured.values ?? {});
    expect(valueKeys).toContain("oidcConfigEncrypted");
    expect(valueKeys).not.toContain("oidcConfig");
    const encrypted = sqlToText(captured.values?.oidcConfigEncrypted);
    expect(encrypted).toMatch(PGP_SYM_ENCRYPT_RE);
    expect(encrypted).toContain("shh");
    expect(encrypted).toMatch(CURRENT_SETTING_SSO_KEY_RE);

    // The .returning() projection must not include any *secret* / encrypted column.
    const returningKeys = Object.keys(
      captured.returning as Record<string, unknown>
    );
    expect(returningKeys).not.toContain("oidcConfigEncrypted");
    expect(returningKeys).not.toContain("oidcConfig");
    expect(returningKeys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);

    // Returned object also redacts.
    const resultKeys = Object.keys(result);
    expect(resultKeys).not.toContain("oidcConfigEncrypted");
    expect(resultKeys).not.toContain("oidcConfig");
    expect(resultKeys.some((k) => SECRET_KEY_RE.test(k))).toBe(false);
  });

  it("rotateEncrypted() updates only the encrypted column and clears legacy plaintext", async () => {
    const captured: { setValues?: Record<string, unknown> } = {};
    const tx = {
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          captured.setValues = vals;
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: "ssop_1" }]),
            }),
          };
        },
      }),
    };

    const updated = await ssoProviderRepository.rotateEncrypted(
      tx as unknown as Parameters<
        typeof ssoProviderRepository.rotateEncrypted
      >[0],
      "org_acme",
      "ssop_1",
      { clientId: "cid", clientSecret: "rotated-secret-9999" }
    );

    expect(updated).toBe(true);
    expect(captured.setValues).toBeDefined();
    const setKeys = Object.keys(captured.setValues ?? {});
    expect(setKeys).toContain("oidcConfigEncrypted");
    expect(setKeys).toContain("oidcConfig");
    expect(captured.setValues?.oidcConfig).toBeNull();
    const encrypted = sqlToText(captured.setValues?.oidcConfigEncrypted);
    expect(encrypted).toMatch(PGP_SYM_ENCRYPT_RE);
    expect(encrypted).toContain("rotated-secret-9999");
    expect(encrypted).toMatch(CURRENT_SETTING_SSO_KEY_RE);
  });

  it("rotateEncrypted() returns false when no row matches", async () => {
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    };

    const updated = await ssoProviderRepository.rotateEncrypted(
      tx as unknown as Parameters<
        typeof ssoProviderRepository.rotateEncrypted
      >[0],
      "org_acme",
      "ssop_missing",
      { clientId: "cid", clientSecret: "x" }
    );
    expect(updated).toBe(false);
  });
});
