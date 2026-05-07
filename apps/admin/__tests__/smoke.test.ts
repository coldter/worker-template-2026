import { describe, expect, it, vi } from "vitest";
import app from "@/server";

describe("apps/admin smoke", () => {
  it("forwards unknown non-/api/* routes to the ADMIN_UI assets binding (SPA fallback)", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await app.request(
      "/unknown",
      {
        headers: { host: "admin.example.com" },
      },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        // boundary: tests inject a Fetcher-compatible stub for ADMIN_UI.
        ADMIN_UI: { fetch: fetchMock } as unknown as Fetcher,
      }
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
