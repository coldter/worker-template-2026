// Asserts the pre-update read runs against the same tx handle as the UPDATE,
// so audit "from" / `previousStatus` cannot be torn by a concurrent writer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const auditTransactionMock = vi.hoisted(() => vi.fn());
const deactivateUserMock = vi.hoisted(() => vi.fn());
const activateUserMock = vi.hoisted(() => vi.fn());
const clearUserLockoutMock = vi.hoisted(() => vi.fn());
const deleteUserSessionsMock = vi.hoisted(() => vi.fn());
const firstOrThrowMock = vi.hoisted(() => vi.fn());
const onUserStatusChangeMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/audit-logs/auditable", () => ({
  auditTransaction: auditTransactionMock,
}));

// Avoid `importActual`: real `@repo/db` pulls in `pg`, which breaks the Workers test pool.
vi.mock("@repo/db", () => ({
  deactivateUser: deactivateUserMock,
  activateUser: activateUserMock,
  clearUserLockout: clearUserLockoutMock,
  deleteUserSessions: deleteUserSessionsMock,
  firstOrThrow: firstOrThrowMock,
}));

vi.mock("@repo/db/schema", () => ({
  accounts: {},
  members: {
    userId: "members.userId",
    organizationId: "members.organizationId",
  },
  users: {
    id: "users.id",
    name: "users.name",
    email: "users.email",
    status: "users.status",
    createdAt: "users.createdAt",
    updatedAt: "users.updatedAt",
    emailVerified: "users.emailVerified",
    image: "users.image",
    roleSlugs: "users.roleSlugs",
  },
}));

vi.mock("../user-status-hooks", () => ({
  onUserStatusChange: onUserStatusChangeMock,
}));

type SelectChain = {
  from: () => SelectChain;
  innerJoin: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<Array<{ user: Record<string, unknown> }>>;
};

function makeSelectChain(result: Array<{ user: Record<string, unknown> }>) {
  const chain: SelectChain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
  };
  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve([]),
  };
  return chain;
}

function makeTx(existingUser: Record<string, unknown> | null) {
  const select = vi.fn(() =>
    makeSelectChain(existingUser ? [{ user: existingUser }] : [])
  );
  return {
    select,
    update: vi.fn(() => makeUpdateChain()),
    insert: vi.fn(),
  };
}

const auditContext = { ipAddress: "127.0.0.1", userAgent: "test" };

describe("userService — read INSIDE auditTransaction", () => {
  beforeEach(() => {
    auditTransactionMock.mockReset();
    deactivateUserMock.mockReset();
    activateUserMock.mockReset();
    clearUserLockoutMock.mockReset();
    deleteUserSessionsMock.mockReset();
    firstOrThrowMock.mockReset();
    onUserStatusChangeMock.mockReset();
  });

  it("updateRoles reads via the transaction handle, not the outer db", async () => {
    const { userService } = await import("../service");
    const existing = {
      id: "u_1",
      name: "Ada",
      email: "ada@example.com",
      status: "active",
      roleSlugs: ["member"],
    };
    const tx = makeTx(existing);
    const updatedRow = { ...existing, roleSlugs: ["admin"] };

    auditTransactionMock.mockImplementation(
      async (
        _db: unknown,
        _ctx: unknown,
        cb: (
          tx: unknown,
          audit: { record: (entry: unknown) => void }
        ) => Promise<unknown>
      ) => cb(tx, { record: vi.fn() })
    );
    firstOrThrowMock.mockResolvedValue(updatedRow);

    const db = { kind: "outer-db" };
    const result = await userService.updateRoles(
      // boundary: test stubs intentionally satisfy structural slot only
      db as unknown as Parameters<typeof userService.updateRoles>[0],
      "org_1",
      "u_1",
      { roleSlugs: ["admin"] },
      "actor_1",
      auditContext
    );

    expect(result).toBe(updatedRow);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(auditTransactionMock).toHaveBeenCalledWith(
      db,
      auditContext,
      expect.any(Function)
    );
  });

  it("deactivate reads in-tx and forwards in-tx previousStatus to onUserStatusChange", async () => {
    const { userService } = await import("../service");
    const existing = {
      id: "u_1",
      name: "Ada",
      email: "ada@example.com",
      status: "active",
    };
    const tx = makeTx(existing);

    auditTransactionMock.mockImplementation(
      async (
        _db: unknown,
        _ctx: unknown,
        cb: (
          tx: unknown,
          audit: { record: (entry: unknown) => void }
        ) => Promise<unknown>
      ) => cb(tx, { record: vi.fn() })
    );
    deactivateUserMock.mockResolvedValue({ id: "u_1", status: "inactive" });
    deleteUserSessionsMock.mockResolvedValue(undefined);

    const db = { kind: "outer-db" };
    await userService.deactivate(
      // boundary: test stubs intentionally satisfy structural slot only
      db as unknown as Parameters<typeof userService.deactivate>[0],
      "org_1",
      "u_1",
      "no longer with us",
      "actor_1",
      auditContext
    );

    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(deactivateUserMock).toHaveBeenCalledWith(
      tx,
      "u_1",
      "actor_1",
      "no longer with us"
    );
    expect(deleteUserSessionsMock).toHaveBeenCalledWith(tx, "u_1");
    expect(onUserStatusChangeMock).toHaveBeenCalledWith(
      "u_1",
      "inactive",
      "active",
      "no longer with us"
    );
  });

  it("activate reads in-tx and forwards in-tx previousStatus to onUserStatusChange", async () => {
    const { userService } = await import("../service");
    const existing = {
      id: "u_1",
      name: "Ada",
      email: "ada@example.com",
      status: "inactive",
    };
    const tx = makeTx(existing);

    auditTransactionMock.mockImplementation(
      async (
        _db: unknown,
        _ctx: unknown,
        cb: (
          tx: unknown,
          audit: { record: (entry: unknown) => void }
        ) => Promise<unknown>
      ) => cb(tx, { record: vi.fn() })
    );
    activateUserMock.mockResolvedValue({ id: "u_1", status: "active" });

    const db = { kind: "outer-db" };
    await userService.activate(
      // boundary: test stubs intentionally satisfy structural slot only
      db as unknown as Parameters<typeof userService.activate>[0],
      "org_1",
      "u_1",
      "actor_1",
      auditContext
    );

    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(activateUserMock).toHaveBeenCalledWith(tx, "u_1");
    expect(onUserStatusChangeMock).toHaveBeenCalledWith(
      "u_1",
      "active",
      "inactive",
      null
    );
  });

  it("unlock reads in-tx and forwards in-tx previousStatus to onUserStatusChange", async () => {
    const { userService } = await import("../service");
    const existing = {
      id: "u_1",
      name: "Ada",
      email: "ada@example.com",
      status: "locked",
    };
    const tx = makeTx(existing);

    auditTransactionMock.mockImplementation(
      async (
        _db: unknown,
        _ctx: unknown,
        cb: (
          tx: unknown,
          audit: { record: (entry: unknown) => void }
        ) => Promise<unknown>
      ) => cb(tx, { record: vi.fn() })
    );
    clearUserLockoutMock.mockResolvedValue({ id: "u_1", status: "active" });

    const db = { kind: "outer-db" };
    await userService.unlock(
      // boundary: test stubs intentionally satisfy structural slot only
      db as unknown as Parameters<typeof userService.unlock>[0],
      "org_1",
      "u_1",
      "actor_1",
      auditContext
    );

    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(clearUserLockoutMock).toHaveBeenCalledWith(tx, "u_1");
    expect(onUserStatusChangeMock).toHaveBeenCalledWith(
      "u_1",
      "active",
      "locked",
      null
    );
  });

  it("updateRoles throws UserNotFoundError when the in-tx read returns null", async () => {
    const { userService } = await import("../service");
    const { UserNotFoundError } = await import("../errors");
    const tx = makeTx(null);

    auditTransactionMock.mockImplementation(
      async (
        _db: unknown,
        _ctx: unknown,
        cb: (
          tx: unknown,
          audit: { record: (entry: unknown) => void }
        ) => Promise<unknown>
      ) => cb(tx, { record: vi.fn() })
    );

    await expect(
      userService.updateRoles(
        // boundary: test stubs intentionally satisfy structural slot only
        { kind: "outer-db" } as unknown as Parameters<
          typeof userService.updateRoles
        >[0],
        "org_1",
        "u_missing",
        { roleSlugs: ["admin"] },
        "actor_1",
        auditContext
      )
    ).rejects.toBeInstanceOf(UserNotFoundError);

    expect(firstOrThrowMock).not.toHaveBeenCalled();
  });
});
