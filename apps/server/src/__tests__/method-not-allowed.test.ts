import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ Client: class {}, default: {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

import app from "@/server";

const env = {
  CACHE: {
    get: async () => null,
    put: async () => undefined,
  },
} as unknown as CloudflareBindings;

describe("method not allowed middleware", () => {
  it("returns 405 with Allow header when the path exists with other methods", async () => {
    const res = await app.request("/health", { method: "POST" }, env);

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    expect(await res.json()).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
  });

  it("keeps supported methods working", async () => {
    const res = await app.request("/health", { method: "GET" }, env);

    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await app.request("/does-not-exist", { method: "PUT" }, env);

    expect(res.status).toBe(404);
  });
});
