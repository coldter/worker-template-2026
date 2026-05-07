import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBindings } from "@/env";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runInactivitySweep", () => {
  it("deactivates global_admins whose lastActiveAt is older than 90 days and emits audit rows", async () => {
    const now = new Date("2026-05-06T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const oldActive = new Date("2026-01-01T00:00:00Z");
    const updateReturning = [
      { id: "gad_1", email: "alice@example.com", lastActiveAt: oldActive },
      { id: "gad_2", email: "bob@example.com", lastActiveAt: oldActive },
    ];
    const returningMock = vi.fn(async () => updateReturning);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(
      (_value: { deactivatedAt: Date; deactivatedReason: string }) => ({
        where: whereMock,
      })
    );
    const updateMock = vi.fn(() => ({ set: setMock }));

    const insertValuesMock = vi.fn(async (_rows: unknown[]) => undefined);
    const insertMock = vi.fn(() => ({ values: insertValuesMock }));

    const txFnMock = (
      callback: (tx: {
        update: typeof updateMock;
        insert: typeof insertMock;
      }) => Promise<unknown>
    ) => callback({ update: updateMock, insert: insertMock });

    vi.doMock("@repo/db", () => ({
      withDrizzleClient: async (
        _connectionString: string,
        callback: (db: unknown) => Promise<unknown>
      ) => callback({ transaction: txFnMock }),
    }));

    const { runInactivitySweep } = await import("@/scheduled/inactivity-sweep");

    const env = {
      HYPERDRIVE: { connectionString: "postgresql://x" },
    } as unknown as AdminBindings;

    const result = await runInactivitySweep(env);
    expect(result.deactivated).toBe(2);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledOnce();
    const setArg = setMock.mock.calls[0]?.[0] as
      | { deactivatedAt: Date; deactivatedReason: string }
      | undefined;
    expect(setArg?.deactivatedReason).toBe("inactivity_90d");

    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledOnce();
    const auditRows = insertValuesMock.mock.calls[0]?.[0] as Array<{
      event: string;
      actorType: string;
      actorId: string | null;
      targetId: string;
      metadata: { reason: string; lastActiveAt: string | null };
    }>;
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]?.event).toBe("global_admin.deactivated");
    expect(auditRows[0]?.actorType).toBe("system");
    expect(auditRows[0]?.actorId).toBeNull();
    expect(auditRows[0]?.targetId).toBe("gad_1");
    expect(auditRows[0]?.metadata.reason).toBe("inactivity_90d");
    expect(auditRows[0]?.metadata.lastActiveAt).toBe(oldActive.toISOString());
  });

  it("skips audit insert when no rows are deactivated", async () => {
    const returningMock = vi.fn(async () => []);
    const whereMock = vi.fn(() => ({ returning: returningMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const updateMock = vi.fn(() => ({ set: setMock }));
    const insertMock = vi.fn();

    const txFnMock = (
      callback: (tx: {
        update: typeof updateMock;
        insert: typeof insertMock;
      }) => Promise<unknown>
    ) => callback({ update: updateMock, insert: insertMock });

    vi.doMock("@repo/db", () => ({
      withDrizzleClient: async (
        _connectionString: string,
        callback: (db: unknown) => Promise<unknown>
      ) => callback({ transaction: txFnMock }),
    }));

    const { runInactivitySweep } = await import("@/scheduled/inactivity-sweep");
    const env = {
      HYPERDRIVE: { connectionString: "postgresql://x" },
    } as unknown as AdminBindings;
    const result = await runInactivitySweep(env);
    expect(result.deactivated).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
