import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { principalNotActive } from "../conditions";
import {
  AUTHORIZATION_GUARD,
  createAuthorize,
  getAuthorizedResource,
  isAuthorizationGuard,
} from "../hono";
import { createAuthSchema } from "../schema";
import type { Principal } from "../types";

const NO_RESOURCE_LOADED = /no resource was loaded/;

const auth = createAuthSchema({
  globalPolicies: (p) => [
    p.deny("*").to("*").whereCondition(principalNotActive()),
  ],
  roles: ["admin", "user"],
  systemAdminRoles: ["admin"],
});

interface TestResource {
  createdBy: string;
  id: string;
}

const testResource = auth.createResource<TestResource>()("test", {
  actions: ["list", "view", "create", "update", "delete", "explode"],
  policies: (p) => [
    p.allow("admin").to("*"),
    p.allow("user").to("list"),
    p.allow("user").to("view", "update").whereOwner(),
    p
      .allow("user")
      .to("explode")
      .where(
        () => {
          throw new Error("condition boom");
        },
        { effect: "principal_only" }
      ),
  ],
  resolveOwner: (r) => r.createdBy,
});

const registry = auth.buildRegistry({ test: testResource });

const adminPrincipal: Principal = {
  attributes: { status: "active" },
  id: "usr_admin",
  roles: ["admin"],
};
const userPrincipal: Principal = {
  attributes: { status: "active" },
  id: "usr_1",
  roles: ["user"],
};

describe("createAuthorize", () => {
  const authorize = createAuthorize(registry, {
    resolvePrincipal: (c) => {
      const principalHeader = c.req.header("x-test-principal");
      if (!principalHeader) {
        return null;
      }
      return JSON.parse(principalHeader) as Principal;
    },
  });

  it("authorize(resource, action) allows admin", async () => {
    const app = new Hono();
    app.use("/test", authorize("test", "list"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-test-principal": JSON.stringify(adminPrincipal) },
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when no principal", async () => {
    const app = new Hono();
    app.use("/test", authorize("test", "list"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("returns 403 when unauthorized", async () => {
    const app = new Hono();
    app.use("/test", authorize("test", "create"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(403);
  });

  it("authorize with loadResource allows owner", async () => {
    const app = new Hono();
    app.use(
      "/test/:id",
      authorize("test", "view", {
        loadResource: async () => ({ createdBy: "usr_1", id: "res_1" }),
      })
    );
    app.get("/test/:id", (c) => {
      const resource = getAuthorizedResource<TestResource>(c);
      return c.json({ id: resource.id });
    });

    const res = await app.request("/test/res_1", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("res_1");
  });

  it("getAuthorizedResource throws when no resource was loaded", async () => {
    const app = new Hono();
    app.onError((err, c) =>
      c.json(
        { error: { code: "INTERNAL_ERROR", message: err.message } },
        { status: 500 }
      )
    );
    app.use("/test", authorize("test", "list"));
    app.get("/test", (c) => {
      const resource = getAuthorizedResource<TestResource>(c);
      return c.json({ id: resource.id });
    });

    const res = await app.request("/test", {
      headers: { "x-test-principal": JSON.stringify(adminPrincipal) },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toMatch(NO_RESOURCE_LOADED);
  });

  it("authorize with loadResource denies non-owner", async () => {
    const app = new Hono();
    app.use(
      "/test/:id",
      authorize("test", "view", {
        loadResource: async () => ({ createdBy: "usr_other", id: "res_1" }),
      })
    );
    app.get("/test/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/test/res_1", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(403);
  });

  it("propagates loadResource errors to Hono onError (does not 403)", async () => {
    const app = new Hono();
    app.onError((err, c) =>
      c.json(
        { error: { code: "INTERNAL_ERROR", message: err.message } },
        { status: 500 }
      )
    );
    app.use(
      "/test/:id",
      authorize("test", "view", {
        loadResource: async () => {
          throw new Error("db error");
        },
      })
    );
    app.get("/test/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/test/res_1", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("db error");
  });

  it("returns FORBIDDEN with uniform body when loadResource returns null", async () => {
    const app = new Hono();
    app.use(
      "/test/:id",
      authorize("test", "view", {
        loadResource: async () => null,
      })
    );
    app.get("/test/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/test/res_1", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "FORBIDDEN", message: "Forbidden" },
    });
  });

  it("returns NOT_FOUND when an allowed action targets a missing resource", async () => {
    const app = new Hono();
    app.use(
      "/test/:id",
      authorize("test", "view", {
        loadResource: async () => null,
      })
    );
    app.get("/test/:id", (c) => c.json({ ok: true }));

    const res = await app.request("/test/res_1", {
      headers: { "x-test-principal": JSON.stringify(adminPrincipal) },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Not Found" },
    });
  });

  it("returns INTERNAL_ERROR with status 500 when a condition throws", async () => {
    const app = new Hono();
    app.use("/test", authorize("test", "explode"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-test-principal": JSON.stringify(userPrincipal) },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal Server Error" },
    });
  });
});

describe("isAuthorizationGuard", () => {
  it("createAuthorize marks every returned middleware", () => {
    const authorize = createAuthorize(registry, {
      resolvePrincipal: () => null,
    });

    expect(isAuthorizationGuard(authorize("test", "list"))).toBe(true);
    expect(
      isAuthorizationGuard(
        authorize("test", "view", {
          loadResource: async () => ({ createdBy: "u1", id: "u1" }),
        })
      )
    ).toBe(true);
  });

  it("rejects functions without the guard marker", () => {
    expect(isAuthorizationGuard(async () => undefined)).toBe(false);
  });

  it("rejects values that are not functions", () => {
    expect(isAuthorizationGuard({ [AUTHORIZATION_GUARD]: true })).toBe(false);
    expect(isAuthorizationGuard(null)).toBe(false);
    expect(isAuthorizationGuard(undefined)).toBe(false);
  });
});
