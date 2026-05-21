import { describe, expect, it, vi } from "vitest";

// provisionUserCallback runs AFTER token exchange. The earlier-fail gate is
// ssoCallbackGuardPlugin.
import { provisionUserCallback } from "../plugins/provision-user";

type MockDb = {
  query: {
    users: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  select: ReturnType<typeof vi.fn>;
};

function makeMockDb(overrides: Partial<MockDb> = {}): MockDb {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
  return {
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    select,
    ...overrides,
  };
}

const baseProvider = {
  id: "prov_1",
  issuer: "https://idp.example.com",
  domain: "example.com",
  userId: "user_1",
  providerId: "pid_1",
  organizationId: "org_acme",
  domainVerified: true,
};

const baseUser = {
  id: "user_new",
  email: "alice@example.com",
  name: "Alice",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseUserInfo = {
  email: "alice@example.com",
  email_verified: true,
  sub: "alice-sub",
};

describe("provisionUserCallback", () => {
  it("throws FORBIDDEN when email_verified is false", async () => {
    const db = makeMockDb();
    // boundary: test fixture reflection — db is structurally compatible at runtime
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: baseUser,
        userInfo: { ...baseUserInfo, email_verified: false },
        provider: baseProvider,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Email not verified by IdP",
    });
  });

  it("throws INTERNAL_SERVER_ERROR when provider.organizationId is missing", async () => {
    const db = makeMockDb();
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: baseUser,
        userInfo: baseUserInfo,
        // boundary: test fixture reflection — omit organizationId to test guard
        provider: {
          ...baseProvider,
          organizationId: undefined,
        } as unknown as typeof baseProvider,
      })
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws FORBIDDEN when provider.domainVerified is false", async () => {
    const db = makeMockDb();
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: baseUser,
        userInfo: baseUserInfo,
        // boundary: test fixture reflection — override domainVerified for the test case
        provider: {
          ...baseProvider,
          domainVerified: false,
        } as unknown as typeof baseProvider,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "SSO domain not verified",
    });
  });

  it("throws FORBIDDEN when an existing user with the same email lacks membership in provider org", async () => {
    const existingUser = { id: "user_other", email: "alice@example.com" };
    const db = makeMockDb({
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(existingUser),
        },
      },
    });
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: { ...baseUser, id: "user_new_different" },
        userInfo: baseUserInfo,
        provider: baseProvider,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Email belongs to a user without membership in this org",
    });
  });

  it("resolves when all three conditions pass and no conflicting existing user", async () => {
    const db = makeMockDb();
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: baseUser,
        userInfo: baseUserInfo,
        provider: baseProvider,
      })
    ).resolves.toBeUndefined();
  });

  it("resolves when existing user is the same as the signing-in user (re-login)", async () => {
    const db = makeMockDb({
      query: {
        users: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: baseUser.id, email: baseUser.email }),
        },
      },
    });
    const cb = provisionUserCallback(
      db as unknown as Parameters<typeof provisionUserCallback>[0],
      null
    );
    await expect(
      cb({
        user: baseUser,
        userInfo: baseUserInfo,
        provider: baseProvider,
      })
    ).resolves.toBeUndefined();
  });
});
