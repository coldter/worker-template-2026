import type { DrizzleClient } from "@repo/db";
import { describe, expect, it } from "vitest";

import { checkReadiness } from "@/modules/status/service";
import type { ReadinessCache } from "@/modules/status/service";

const fakeDb = (
  execute: (query: string) => Promise<unknown[]>
): DrizzleClient =>
  // SAFETY: readiness probes only read db.execute, so a proxy that answers every member with the probe is a complete double for that call path.
  new Proxy({} as DrizzleClient, {
    get: () => execute,
  });

const healthyCache: ReadinessCache = { get: () => Promise.resolve(null) };

describe("readiness checks", () => {
  it("reports ok when all probes succeed", async () => {
    const checks = await checkReadiness(
      fakeDb(() => Promise.resolve([])),
      healthyCache
    );

    expect(checks).toStrictEqual({ cache: true, database: true });
  });

  it("reports database unavailable when the probe rejects", async () => {
    const checks = await checkReadiness(
      fakeDb(() => Promise.reject(new Error("connection refused"))),
      healthyCache
    );

    expect(checks).toStrictEqual({ cache: true, database: false });
  });

  it("reports database unavailable when the probe hangs past the timeout", async () => {
    const checks = await checkReadiness(
      // oxlint-disable-next-line promise/avoid-new -- the timeout branch can only be reached with a promise that never settles.
      fakeDb(() => new Promise<never>(() => {})),
      healthyCache,
      20
    );

    expect(checks).toStrictEqual({ cache: true, database: false });
  });

  it("reports cache unavailable when the KV probe rejects", async () => {
    const checks = await checkReadiness(
      fakeDb(() => Promise.resolve([])),
      {
        get: () => Promise.reject(new Error("kv unavailable")),
      }
    );

    expect(checks).toStrictEqual({ cache: false, database: true });
  });
});
