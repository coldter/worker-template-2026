import { describe, expect, it, vi } from "vitest";
import handler from "@/index";

type Env = {
  ASSETS: Fetcher;
  API: Fetcher;
  NODE_ENV?: string;
};

function buildEnv(
  opts: {
    apiResponse?: () => Promise<Response>;
    assetsResponse?: () => Promise<Response>;
    nodeEnv?: string;
  } = {}
): {
  env: Env;
  assets: ReturnType<typeof vi.fn>;
  api: ReturnType<typeof vi.fn>;
} {
  const assets = vi.fn(
    opts.assetsResponse ?? (async () => new Response("assets"))
  );
  const api = vi.fn(opts.apiResponse ?? (async () => new Response("api")));
  // boundary: wrangler `Fetcher` shape carries methods we don't exercise in
  // tests; the cast narrows our stub to the binding contract used by the
  // handler under test.
  const env: Env = {
    ASSETS: { fetch: assets } as unknown as Fetcher,
    API: { fetch: api } as unknown as Fetcher,
    NODE_ENV: opts.nodeEnv,
  };
  return { env, assets, api };
}

describe("apps/app fetch handler", () => {
  it("forwards /api/auth/* to env.API so server tenancy middleware can proxy auth RPC", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request(
      "https://acme.app.example.com/api/auth/sign-in/email"
    );
    // boundary: handler is typed on the project CloudflareBindings; the test
    // env is a structural subset for the bindings it actually touches.
    const res = await handler.fetch(req, env as never);
    expect(api).toHaveBeenCalledTimes(1);
    expect(assets).not.toHaveBeenCalled();
    expect(await res.text()).toBe("api");
  });

  it("forwards /api/* (non-auth) to env.API", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request("https://acme.app.example.com/api/tenancy/current");
    const res = await handler.fetch(req, env as never);
    expect(api).toHaveBeenCalledTimes(1);
    expect(assets).not.toHaveBeenCalled();
    expect(await res.text()).toBe("api");
  });

  it("forwards everything else to env.ASSETS", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request("https://acme.app.example.com/dashboard");
    const res = await handler.fetch(req, env as never);
    expect(assets).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
    expect(await res.text()).toBe("assets");
  });
});

describe("apps/app security headers", () => {
  it("attaches the full CSP/HSTS/Referrer/COOP/X-Frame set on HTML responses", async () => {
    const { env } = buildEnv({
      assetsResponse: async () =>
        new Response("<!doctype html><html></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
    const req = new Request("https://acme.app.example.com/dashboard");
    const res = await handler.fetch(req, env as never);
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'self'"
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("attaches the strict subset (HSTS + nosniff) on JSON responses, without CSP", async () => {
    const { env } = buildEnv({
      apiResponse: async () => Response.json({ ok: true }),
    });
    const req = new Request("https://acme.app.example.com/api/tenancy/current");
    const res = await handler.fetch(req, env as never);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("apps/app dev-header stripping", () => {
  it("strips x-dev-tenant-slug from /api/* requests in production", async () => {
    const { env, api } = buildEnv({ nodeEnv: "production" });
    const req = new Request(
      "https://acme.app.example.com/api/tenancy/current",
      {
        headers: { "x-dev-tenant-slug": "spoof" },
      }
    );
    await handler.fetch(req, env as never);
    expect(api).toHaveBeenCalledTimes(1);
    const forwarded = api.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get("x-dev-tenant-slug")).toBeNull();
  });

  it("forwards x-dev-tenant-slug unchanged outside production", async () => {
    const { env, api } = buildEnv({ nodeEnv: "development" });
    const req = new Request(
      "https://acme.app.example.com/api/tenancy/current",
      {
        headers: { "x-dev-tenant-slug": "acme" },
      }
    );
    await handler.fetch(req, env as never);
    const forwarded = api.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get("x-dev-tenant-slug")).toBe("acme");
  });
});

describe("apps/app 502 on upstream failure", () => {
  it("returns a stable BAD_GATEWAY JSON when env.API.fetch throws", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { env } = buildEnv({
        apiResponse: async () => {
          throw new Error("binding offline");
        },
      });
      const req = new Request(
        "https://acme.app.example.com/api/tenancy/current"
      );
      const res = await handler.fetch(req, env as never);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("BAD_GATEWAY");
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(consoleErr).toHaveBeenCalled();
    } finally {
      consoleErr.mockRestore();
    }
  });
});
