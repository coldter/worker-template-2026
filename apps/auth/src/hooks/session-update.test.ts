import type { DrizzleClient } from "@repo/db";
import { describe, expect, test } from "vitest";
import { SESSION_CONFIG } from "../lib/platform";
import {
  createSessionUpdateBeforeHook,
  type SessionUpdateHookContext,
} from "./session-update";

function createDatabaseStub(): DrizzleClient {
  // SAFETY: both tests resolve before the hook reaches a database call, so the stub value is never read.
  return {} as DrizzleClient;
}

type SessionUpdateResult = Awaited<
  ReturnType<ReturnType<typeof createSessionUpdateBeforeHook>>
>;

function readExpiresAt(result: SessionUpdateResult): number {
  const { expiresAt } = result.data;
  if (!(expiresAt instanceof Date)) {
    throw new Error("expected the hook to return an expiresAt");
  }
  return expiresAt.getTime();
}

const db = createDatabaseStub();

function createContext(platform: "mobile" | "web"): SessionUpdateHookContext {
  return {
    context: {
      session: {
        session: { platform },
        user: { id: "usr_test" },
      },
    },
  };
}

describe("createSessionUpdateBeforeHook", () => {
  test.each([
    ["web", SESSION_CONFIG.web.expiresIn],
    ["mobile", SESSION_CONFIG.mobile.expiresIn],
  ] as const)(
    "extends a %s session by its platform lifetime",
    async (platform, expiresIn) => {
      const hook = createSessionUpdateBeforeHook(db);
      const now = Date.now();

      const result = await hook(
        { expiresAt: new Date(now - 60_000), updatedAt: new Date(now) },
        createContext(platform)
      );

      const expiresAt = readExpiresAt(result);
      expect(expiresAt).toBeGreaterThanOrEqual(now + (expiresIn - 5) * 1000);
      expect(expiresAt).toBeLessThanOrEqual(now + (expiresIn + 5) * 1000);
    }
  );

  test("leaves updates without an expiry untouched", async () => {
    const hook = createSessionUpdateBeforeHook(db);

    const result = await hook({ activeOrgRole: null }, createContext("mobile"));

    expect(result).toEqual({ data: { activeOrgRole: null } });
  });
});
