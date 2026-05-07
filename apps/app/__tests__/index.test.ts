import { describe, expect, it, vi } from "vitest";
import handler from "@/index";

type Env = {
  ASSETS: Fetcher;
  API: Fetcher;
};

function buildEnv(): {
  env: Env;
  assets: ReturnType<typeof vi.fn>;
  api: ReturnType<typeof vi.fn>;
} {
  const assets = vi.fn(async () => new Response("assets"));
  const api = vi.fn(async () => new Response("api"));
  // boundary: wrangler `Fetcher` shape carries methods we don't exercise in
  // tests; the cast narrows our stub to the binding contract used by the
  // handler under test.
  const env: Env = {
    ASSETS: { fetch: assets } as unknown as Fetcher,
    API: { fetch: api } as unknown as Fetcher,
  };
  return { env, assets, api };
}

describe("apps/app fetch handler", () => {
  it("forwards /api/auth/* to env.API so server tenancy middleware can proxy auth RPC", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request(
      "https://acme.app.example.com/api/auth/sign-in/email"
    );
    const res = await handler.fetch(req, env);
    expect(api).toHaveBeenCalledWith(req);
    expect(assets).not.toHaveBeenCalled();
    expect(await res.text()).toBe("api");
  });

  it("forwards /api/* (non-auth) to env.API", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request("https://acme.app.example.com/api/tenancy/current");
    const res = await handler.fetch(req, env);
    expect(api).toHaveBeenCalledWith(req);
    expect(assets).not.toHaveBeenCalled();
    expect(await res.text()).toBe("api");
  });

  it("forwards everything else to env.ASSETS", async () => {
    const { env, assets, api } = buildEnv();
    const req = new Request("https://acme.app.example.com/dashboard");
    const res = await handler.fetch(req, env);
    expect(assets).toHaveBeenCalledWith(req);
    expect(api).not.toHaveBeenCalled();
    expect(await res.text()).toBe("assets");
  });
});
