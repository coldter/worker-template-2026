import type { DrizzleClient } from "@repo/db";
import { describe, expect, test } from "vitest";
import { SESSION_CONFIG } from "../lib/platform";
import { createSessionUpdateBeforeHook } from "./session-update";

const db = {} as DrizzleClient;

function createContext(platform: "mobile" | "web") {
  return {
    context: {
      session: {
        session: { platform },
        user: { id: "usr_test" },
      },
    },
  } as unknown as { headers?: Headers };
}

function readExpiresAt(result: unknown): number {
  const { expiresAt } = (result as { data?: { expiresAt?: Date } }).data ?? {};
  if (!expiresAt) {
    throw new Error("expected the hook to return an expiresAt");
  }
  return expiresAt.getTime();
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
