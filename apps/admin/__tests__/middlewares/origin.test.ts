import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AdminBindings, AdminEnv } from "@/env";
import { adminOriginMiddleware } from "@/middlewares/origin";

const baseEnv = {
  ADMIN_HOST: "admin.example.com",
} as unknown as AdminBindings;

describe("adminOriginMiddleware", () => {
  it("rejects mismatched Origin on POST", async () => {
    const app = new Hono<AdminEnv>();
    app.use("*", adminOriginMiddleware);
    app.post("/m", (c) => c.text("ok"));
    const res = await app.request(
      "/m",
      {
        method: "POST",
        headers: {
          host: "admin.example.com",
          origin: "https://evil.com",
        },
      },
      baseEnv
    );
    expect(res.status).toBe(403);
  });

  it("allows matching Origin", async () => {
    const app = new Hono<AdminEnv>();
    app.use("*", adminOriginMiddleware);
    app.post("/m", (c) => c.text("ok"));
    const res = await app.request(
      "/m",
      {
        method: "POST",
        headers: {
          host: "admin.example.com",
          origin: "https://admin.example.com",
        },
      },
      baseEnv
    );
    expect(res.status).toBe(200);
  });

  it("skips origin check on GET", async () => {
    const app = new Hono<AdminEnv>();
    app.use("*", adminOriginMiddleware);
    app.get("/g", (c) => c.text("ok"));
    const res = await app.request(
      "/g",
      { headers: { host: "admin.example.com" } },
      baseEnv
    );
    expect(res.status).toBe(200);
  });
});
