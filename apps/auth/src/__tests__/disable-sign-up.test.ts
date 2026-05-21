import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { disableSignUpHook } from "../disable-sign-up";

const baseUser = {
  id: "user_test",
  name: "Test User",
  email: "test@example.com",
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("disableSignUpHook", () => {
  it("throws APIError FORBIDDEN on public sign-up path (no session)", async () => {
    const { create } = disableSignUpHook();
    await expect(create.before(baseUser, null)).rejects.toThrow(APIError);
  });

  it("throws APIError FORBIDDEN when context has no session user", async () => {
    const { create } = disableSignUpHook();
    const ctx = {
      context: { session: null },
    } as unknown as GenericEndpointContext;
    await expect(create.before(baseUser, ctx)).rejects.toThrow(APIError);
  });

  it("passes through when admin session is present (admin createUser path)", async () => {
    const { create } = disableSignUpHook();
    const ctx = {
      context: {
        session: {
          user: { id: "admin_user", roleSlugs: ["admin"] },
        },
      },
    } as unknown as GenericEndpointContext;
    const result = await create.before(baseUser, ctx);
    expect(result).toBeDefined();
    const r = result as { data: typeof baseUser & Record<string, unknown> };
    expect(r.data.email).toBe(baseUser.email);
  });

  it("thrown error has FORBIDDEN status", async () => {
    const { create } = disableSignUpHook();
    try {
      await create.before(baseUser, null);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err instanceof APIError).toBe(true);
      if (err instanceof APIError) {
        expect(err.status).toBe("FORBIDDEN");
      }
    }
  });

  it("admin path result preserves original user data", async () => {
    const { create } = disableSignUpHook();
    const ctx = {
      context: { session: { user: { id: "admin" } } },
    } as unknown as GenericEndpointContext;
    const result = await create.before({ ...baseUser, id: "u_custom" }, ctx);
    const r = result as { data: typeof baseUser };
    expect(r.data.id).toBe("u_custom");
    expect(r.data.name).toBe(baseUser.name);
  });
});
