import { describe, expect, it } from "vitest";
import app from "@/server";
import { testBindings } from "../../tests/helpers";

const env = testBindings({
  CACHE: {
    get: async () => null,
    put: async () => undefined,
  },
});

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
});
