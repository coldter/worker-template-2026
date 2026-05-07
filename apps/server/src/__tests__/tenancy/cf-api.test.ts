import { describe, expect, it, vi } from "vitest";
import createSuccess from "@/modules/tenancy/__tests__/fixtures/cf-saas/create-success.json";
import getActive from "@/modules/tenancy/__tests__/fixtures/cf-saas/get-active.json";
import getDeleted from "@/modules/tenancy/__tests__/fixtures/cf-saas/get-deleted.json";
import {
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
} from "@/modules/tenancy/cf-api";
import { CfApiContractError } from "@/modules/tenancy/cf-api.types";

const ENV = {
  CLOUDFLARE_API_TOKEN: "tok_test",
  CLOUDFLARE_ZONE_ID: "zone_test",
} as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("A5 cf-api wrapper", () => {
  it("createCustomHostname POSTs ssl.method=txt and omits certificate_authority/custom_metadata", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const fetchSpy = vi.fn(async (url: unknown, init?: unknown) => {
      captured.push({
        url: String(url),
        init: (init ?? {}) as RequestInit,
      });
      return jsonResponse(200, createSuccess);
    }) as unknown as typeof globalThis.fetch;

    const result = await createCustomHostname(ENV, "app.acme.test", {
      fetch: fetchSpy,
    });

    expect(captured).toHaveLength(1);
    const call = captured[0];
    if (!call) {
      throw new Error("expected captured fetch call");
    }
    expect(call.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ENV.CLOUDFLARE_ZONE_ID}/custom_hostnames`
    );
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ENV.CLOUDFLARE_API_TOKEN}`);
    const bodyText = typeof call.init.body === "string" ? call.init.body : "";
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    expect(body.hostname).toBe("app.acme.test");
    expect(body.ssl).toEqual({
      method: "txt",
      type: "dv",
      settings: { min_tls_version: "1.2" },
    });
    expect("certificate_authority" in body).toBe(false);
    expect("custom_metadata" in body).toBe(false);
    expect(result.id).toBe(createSuccess.result.id);
  });

  it("retries with exponential backoff on 429", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("rate limited", { status: 429 });
      }
      return jsonResponse(200, createSuccess);
    }) as unknown as typeof globalThis.fetch;
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });

    await createCustomHostname(ENV, "app.acme.test", {
      fetch: fetchSpy,
      sleep,
      // Deterministic jitter so the 25% slot is exercised but bounded.
      random: () => 0,
    });

    expect(calls).toBe(3);
    // Jitter is `floor(backoff * 0.25 * random())`; with random()=0 we get
    // 0 jitter and the raw exponential schedule.
    expect(sleeps).toEqual([250, 500]);
  });

  it("honors Retry-After (delta-seconds) on 429", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return jsonResponse(200, createSuccess);
    }) as unknown as typeof globalThis.fetch;
    const sleeps: number[] = [];
    await createCustomHostname(ENV, "app.acme.test", {
      fetch: fetchSpy,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });
    expect(sleeps[0]).toBe(2000);
  });

  it("getCustomHostname returns null on CF 404", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(404, { success: false, errors: [{ message: "not found" }] })
    ) as unknown as typeof globalThis.fetch;
    const result = await getCustomHostname(ENV, "cf_id_x", {
      fetch: fetchSpy,
      sleep: async () => undefined,
    });
    expect(result).toBeNull();
  });

  it("getCustomHostname Zod-parses an active response", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, getActive)
    ) as unknown as typeof globalThis.fetch;
    const result = await getCustomHostname(ENV, "cf_id_a", {
      fetch: fetchSpy,
      sleep: async () => undefined,
    });
    expect(result?.status).toBe("active");
    expect(result?.ssl.status).toBe("active");
  });

  it("getCustomHostname surfaces deleted shape (deleted top-level status)", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, getDeleted)
    ) as unknown as typeof globalThis.fetch;
    const result = await getCustomHostname(ENV, "cf_id_d", {
      fetch: fetchSpy,
      sleep: async () => undefined,
    });
    expect(result?.status).toBe("deleted");
  });

  it("throws CfApiContractError on malformed envelope", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("nope", { status: 200 })
    ) as unknown as typeof globalThis.fetch;
    await expect(
      getCustomHostname(ENV, "cf_id_x", {
        fetch: fetchSpy,
        sleep: async () => undefined,
      })
    ).rejects.toBeInstanceOf(CfApiContractError);
  });

  it("deleteCustomHostname is idempotent on 404", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("", { status: 404 })
    ) as unknown as typeof globalThis.fetch;
    const ok = await deleteCustomHostname(ENV, "cf_id_x", {
      fetch: fetchSpy,
      sleep: async () => undefined,
    });
    expect(ok).toBe(true);
  });

  it("deleteCustomHostname returns true on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { success: true, errors: [], messages: [], result: {} })
    ) as unknown as typeof globalThis.fetch;
    const ok = await deleteCustomHostname(ENV, "cf_id_x", {
      fetch: fetchSpy,
      sleep: async () => undefined,
    });
    expect(ok).toBe(true);
  });
});
