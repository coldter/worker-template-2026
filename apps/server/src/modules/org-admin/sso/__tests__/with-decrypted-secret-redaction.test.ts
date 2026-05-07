import { logger, redact } from "@repo/shared/logger";
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

import { ssoProviderRepository } from "../repository";

const SET_LOCAL_SSO_KEY_RE = /SET LOCAL app\.sso_key/i;
const SSO_PROVIDERS_DECRYPTED_RE = /sso_providers_decrypted/;
const NOT_FOUND_RE = /not found/;

type FakeTx = {
  execute: ReturnType<typeof vi.fn>;
};

function sqlToText(query: unknown): string {
  // boundary: vendor-SDK generic variance — drizzle's SQL builder produces
  // an object with `queryChunks` (literal fragments + parameters). Serialise
  // the whole thing so the assertion can match against the literal text
  // without depending on internal field names.
  return JSON.stringify(query);
}

function makeFakeDb(rowOidcConfig: unknown) {
  const tx: FakeTx = {
    execute: vi.fn(async (query: unknown) => {
      const text = sqlToText(query);
      if (SET_LOCAL_SSO_KEY_RE.test(text)) {
        return;
      }
      // Treat any other execute call as the SELECT.
      if (rowOidcConfig === null) {
        return { rows: [] };
      }
      return {
        rows: [{ oidc_config: JSON.stringify(rowOidcConfig) }],
      };
    }),
  };
  const db = {
    transaction: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(tx),
  };
  return { db, tx };
}

describe("ssoProviderRepository.withDecryptedSecret", () => {
  it("yields the decrypted oidcConfig to the closure but never returns or persists it", async () => {
    const { db, tx } = makeFakeDb({
      clientId: "cid-123",
      clientSecret: "hunter2",
      discoveryEndpoint: "https://idp/.well-known/openid-configuration",
    });

    const seen: string[] = [];
    const ret = await ssoProviderRepository.withDecryptedSecret(
      // boundary: vendor-SDK generic variance — DrizzleClient is a deeply
      // generic type; the test fixture only implements the methods exercised.
      db as unknown as Parameters<
        typeof ssoProviderRepository.withDecryptedSecret
      >[0],
      "kek",
      "org_acme",
      "ssop_1",
      async (oidcConfig) => {
        seen.push(oidcConfig.clientSecret);
        return "outcome";
      }
    );

    expect(seen).toEqual(["hunter2"]);
    expect(ret).toBe("outcome");
    // The TX must have set the session key BEFORE the SELECT.
    expect(tx.execute).toHaveBeenCalled();
    const firstText = sqlToText(tx.execute.mock.calls[0]?.[0]);
    expect(firstText).toMatch(SET_LOCAL_SSO_KEY_RE);
    // And the second call must be against the decrypted view.
    const secondText = sqlToText(tx.execute.mock.calls[1]?.[0]);
    expect(secondText).toMatch(SSO_PROVIDERS_DECRYPTED_RE);
  });

  it("redact() strips plaintext from the shapes the closure would log", () => {
    // Assert directly against the redactor (the unit under test), covering
    // the camelCase, snake_case, and nested forms the closure exercises.
    const sample = {
      providerId: "ssop_1",
      clientSecret: "topsecret-12345",
      secret: "topsecret-12345",
      nested: { client_secret: "topsecret-12345" },
    };
    const out = JSON.stringify(redact(sample));
    expect(out).not.toContain("topsecret-12345");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("ssop_1");
  });

  it("logger.info routes the context through redact() before emitting", () => {
    // One quick console-spy check to ensure the logger pipeline still calls
    // the redactor — guards against accidental refactors that bypass it.
    const lines: unknown[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(line);
    });
    try {
      logger.info("issuing token", {
        providerId: "ssop_1",
        clientSecret: "topsecret-12345",
      });
    } finally {
      logSpy.mockRestore();
    }
    const haystack = lines
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n");
    expect(haystack).not.toContain("topsecret-12345");
    expect(haystack).toContain("[REDACTED]");
  });

  it("throws when the provider row is not found", async () => {
    const { db } = makeFakeDb(null);
    await expect(
      ssoProviderRepository.withDecryptedSecret(
        db as unknown as Parameters<
          typeof ssoProviderRepository.withDecryptedSecret
        >[0],
        "kek",
        "org_acme",
        "ssop_missing",
        async () => "should-not-run"
      )
    ).rejects.toThrow(NOT_FOUND_RE);
  });
});
