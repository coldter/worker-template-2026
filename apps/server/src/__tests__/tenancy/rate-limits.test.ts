import { describe, expect, it } from "vitest";
import {
  assertWithinDailyLimit,
  assertWithinPendingLimit,
  DAILY_LIMIT,
  PENDING_LIMIT,
  TenancyRateLimitError,
} from "@/modules/tenancy/rate-limits";

type Stub = {
  pendingCount: number;
  dailyCount: number;
};

function makeDb(stub: Stub, kind: "pending" | "daily") {
  return {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            { n: kind === "pending" ? stub.pendingCount : stub.dailyCount },
          ]),
      }),
    }),
  };
}

describe("A5 rate-limits.assertWithinPendingLimit", () => {
  it("does not throw under the pending limit", async () => {
    const db = makeDb(
      { pendingCount: PENDING_LIMIT - 1, dailyCount: 0 },
      "pending"
    );
    // boundary: test fixture reflection — handcrafted db stub matches the
    // narrow query shape used by the production helper.
    await expect(
      assertWithinPendingLimit(
        db as unknown as Parameters<typeof assertWithinPendingLimit>[0],
        "org_x"
      )
    ).resolves.toBeUndefined();
  });

  it("throws TenancyRateLimitError at the pending limit", async () => {
    const db = makeDb(
      { pendingCount: PENDING_LIMIT, dailyCount: 0 },
      "pending"
    );
    await expect(
      assertWithinPendingLimit(
        db as unknown as Parameters<typeof assertWithinPendingLimit>[0],
        "org_x"
      )
    ).rejects.toBeInstanceOf(TenancyRateLimitError);
  });
});

describe("A5 rate-limits.assertWithinDailyLimit", () => {
  it("does not throw below the daily limit", async () => {
    const db = makeDb(
      { pendingCount: 0, dailyCount: DAILY_LIMIT - 1 },
      "daily"
    );
    await expect(
      assertWithinDailyLimit(
        db as unknown as Parameters<typeof assertWithinDailyLimit>[0],
        "org_x"
      )
    ).resolves.toBeUndefined();
  });

  it("throws at the daily limit", async () => {
    const db = makeDb({ pendingCount: 0, dailyCount: DAILY_LIMIT }, "daily");
    await expect(
      assertWithinDailyLimit(
        db as unknown as Parameters<typeof assertWithinDailyLimit>[0],
        "org_x"
      )
    ).rejects.toBeInstanceOf(TenancyRateLimitError);
  });
});
