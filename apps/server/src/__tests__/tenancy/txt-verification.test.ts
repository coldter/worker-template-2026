import { describe, expect, it } from "vitest";
import type { DohResolver, DohResponse } from "@/modules/tenancy/doh-resolver";
import { verifyTxtRecord } from "@/modules/tenancy/txt-verification";

const HOSTNAME = "app.acme.test";
const LABEL = "_app-verify";
const TOKEN = "vtok_abc123";

function ok(answer: string): DohResolver {
  return async () =>
    ({
      Status: 0,
      Answer: [
        {
          name: `${LABEL}.${HOSTNAME}.`,
          type: 16,
          TTL: 60,
          data: `"${answer}"`,
        },
      ],
    }) satisfies DohResponse;
}

function nxdomain(): DohResolver {
  return async () => ({ Status: 3 }) satisfies DohResponse;
}

function reject(): DohResolver {
  return async () => {
    throw new Error("network down");
  };
}

describe("A5 verifyTxtRecord (D14)", () => {
  it("ok when single resolver returns the matching token", async () => {
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: ok(TOKEN),
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: true });
  });

  it("ok when ANY resolver in a dual list returns the match", async () => {
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: [reject(), ok(TOKEN)],
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: true });
  });

  it("no_record on NXDOMAIN", async () => {
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: nxdomain(),
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: false, reason: "no_record" });
  });

  it("mismatch when resolver returns a different TXT", async () => {
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: ok("vtok_other"),
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: false, reason: "mismatch" });
  });

  it("resolver_error when all resolvers throw", async () => {
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: [reject(), reject()],
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: false, reason: "resolver_error" });
  });

  it("ok when multiple TXT records exist and one matches", async () => {
    const multiResolver: DohResolver = async () => ({
      Status: 0,
      Answer: [
        { data: '"vtok_unrelated"' },
        { data: `"${TOKEN}"` },
        { data: '"google-site-verification=xyz"' },
      ],
    });
    const r = await verifyTxtRecord(HOSTNAME, TOKEN, {
      dohResolver: multiResolver,
      verificationLabel: LABEL,
    });
    expect(r).toEqual({ ok: true });
  });
});
