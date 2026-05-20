import { describe, expect, it, vi } from "vitest";
import { safeWaitUntil } from "../safe-wait-until";

describe("safeWaitUntil", () => {
  it("catches rejection when ctx is undefined", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: PromiseRejectionEvent | { reason: unknown }) => {
      // Node emits `unhandledRejection` with the reason as the first arg in
      // process listeners; in vitest's node env we use a process listener.
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      safeWaitUntil(undefined, Promise.reject(new Error("boom")));
      // Let microtasks flush so any unhandled rejection would surface.
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("catches rejection when ctx.waitUntil throws synchronously", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: PromiseRejectionEvent | { reason: unknown }) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const ctx = {
        waitUntil(_p: Promise<unknown>): void {
          throw new Error("isolate closed");
        },
      };
      safeWaitUntil(ctx, Promise.reject(new Error("boom")));
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("calls user-supplied onError with the rejection reason", async () => {
    const reason = new Error("ping-failed");
    const onError = vi.fn();
    const ctx = { waitUntil: vi.fn() };
    safeWaitUntil(ctx, Promise.reject(reason), onError);
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(reason);
  });

  it("calls ctx.waitUntil exactly once for happy path", async () => {
    const ctx = { waitUntil: vi.fn() };
    const promise = Promise.resolve("ok");
    safeWaitUntil(ctx, promise);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).toHaveBeenCalledWith(promise);
    await promise;
  });
});
