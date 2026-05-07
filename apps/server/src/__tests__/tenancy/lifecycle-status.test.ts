import { describe, expect, it } from "vitest";
import {
  customHostnameLifecycle,
  isReconcilable,
  isTerminal,
  mapCloudflareStatus,
} from "@/modules/tenancy/lifecycle-status";

describe("A5 lifecycle-status enum", () => {
  it("contains the seven documented states in order", () => {
    expect(customHostnameLifecycle).toEqual([
      "pending_txt",
      "awaiting_cf",
      "pre_validation",
      "active",
      "failed",
      "removing",
      "removed",
    ]);
  });
});

describe("A5 mapCloudflareStatus — status mapping table", () => {
  it("missing CF status (row pre-CF) -> pending_txt", () => {
    expect(mapCloudflareStatus(null, null, false)).toBe("pending_txt");
    expect(mapCloudflareStatus(undefined, null, false)).toBe("pending_txt");
  });

  it("pending + initializing -> awaiting_cf", () => {
    expect(mapCloudflareStatus("pending", "initializing", false)).toBe(
      "awaiting_cf"
    );
  });

  it("pending + pending_validation (no records) -> awaiting_cf", () => {
    expect(mapCloudflareStatus("pending", "pending_validation", false)).toBe(
      "awaiting_cf"
    );
  });

  it("pending + pending_validation (with records) -> pre_validation", () => {
    expect(mapCloudflareStatus("pending", "pending_validation", true)).toBe(
      "pre_validation"
    );
  });

  it("pending + pending_issuance -> awaiting_cf", () => {
    expect(mapCloudflareStatus("pending", "pending_issuance", false)).toBe(
      "awaiting_cf"
    );
  });

  it("pending + pending_deployment -> awaiting_cf", () => {
    expect(mapCloudflareStatus("pending", "pending_deployment", false)).toBe(
      "awaiting_cf"
    );
  });

  it("active + active -> active (terminal-success)", () => {
    expect(mapCloudflareStatus("active", "active", false)).toBe("active");
  });

  it("active + non-active ssl -> awaiting_cf", () => {
    expect(mapCloudflareStatus("active", "pending_deployment", false)).toBe(
      "awaiting_cf"
    );
    expect(mapCloudflareStatus("active", "initializing", false)).toBe(
      "awaiting_cf"
    );
  });

  it("moved -> failed", () => {
    expect(mapCloudflareStatus("moved", "pending_validation", false)).toBe(
      "failed"
    );
  });

  it("deleted -> removed", () => {
    expect(mapCloudflareStatus("deleted", "deactivated", false)).toBe(
      "removed"
    );
  });

  it("pending_blocked / blocked -> failed", () => {
    expect(mapCloudflareStatus("pending_blocked", null, false)).toBe("failed");
    expect(mapCloudflareStatus("blocked", null, false)).toBe("failed");
  });

  it("any + caa_error verification error -> failed", () => {
    expect(
      mapCloudflareStatus("pending", "pending_validation", false, ["caa_error"])
    ).toBe("failed");
  });

  it("validation_timed_out -> failed", () => {
    expect(mapCloudflareStatus("pending", "validation_timed_out", false)).toBe(
      "failed"
    );
  });

  it("ssl.expired -> failed", () => {
    expect(mapCloudflareStatus("active", "expired", false)).toBe("failed");
  });

  it("ssl.deactivated -> failed (operator deactivation)", () => {
    expect(mapCloudflareStatus("active", "deactivated", false)).toBe("failed");
  });
});

describe("A5 isTerminal", () => {
  it("returns true for active and removed", () => {
    expect(isTerminal("active")).toBe(true);
    expect(isTerminal("removed")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isTerminal("pending_txt")).toBe(false);
    expect(isTerminal("awaiting_cf")).toBe(false);
    expect(isTerminal("pre_validation")).toBe(false);
    expect(isTerminal("failed")).toBe(false);
    expect(isTerminal("removing")).toBe(false);
  });
});

describe("A5 isReconcilable", () => {
  it("returns true for awaiting_cf, pre_validation, failed, active", () => {
    expect(isReconcilable("awaiting_cf")).toBe(true);
    expect(isReconcilable("pre_validation")).toBe(true);
    expect(isReconcilable("failed")).toBe(true);
    // `active` is reconcilable so the reconciler can detect deactivations
    // (CF flips ssl_status to expired/deactivated).
    expect(isReconcilable("active")).toBe(true);
  });

  it("returns false for terminal removed and pending_txt", () => {
    expect(isReconcilable("removed")).toBe(false);
    expect(isReconcilable("pending_txt")).toBe(false);
  });

  it("returns false for fresh `removing` rows", () => {
    // Default age threshold = +Infinity (never reconcile).
    expect(isReconcilable("removing")).toBe(false);
    expect(isReconcilable("removing", new Date("2026-05-07T00:00:00Z"))).toBe(
      false
    );
  });

  it("returns true for stale `removing` rows past the threshold", () => {
    const stamp = new Date("2026-05-07T00:00:00Z");
    const sixMinLater = new Date(stamp.getTime() + 6 * 60 * 1000);
    expect(isReconcilable("removing", stamp, sixMinLater, 5 * 60 * 1000)).toBe(
      true
    );
  });
});
