import { describe, expect, it } from "vitest";
import { parseAuditLogMessage } from "@/modules/audit-logs/queue-message";

describe("parseAuditLogMessage", () => {
  it("accepts a well-formed bufferable message and defaults actorType", () => {
    const data = parseAuditLogMessage({
      event: "user.viewed",
      targetId: "usr_1",
      targetType: "user",
      occurredAt: "2026-06-09T00:00:00.000Z",
    });

    expect(data).not.toBeNull();
    expect(data?.event).toBe("user.viewed");
    expect(data?.actorType).toBe("user");
  });

  it("preserves provided fields", () => {
    const data = parseAuditLogMessage({
      event: "user.listed",
      actorId: "usr_123",
      actorType: "api",
      ipAddress: "1.2.3.4",
      metadata: { count: 25 },
      occurredAt: "2026-06-09T00:00:00.000Z",
    });

    expect(data?.actorType).toBe("api");
    expect(data?.metadata).toEqual({ count: 25 });
  });

  it.each([
    ["null", null],
    ["a non-object", "nope"],
    [
      "a critical (non-bufferable) event",
      { event: "user.created", occurredAt: "2026-06-09T00:00:00.000Z" },
    ],
    ["a message missing occurredAt", { event: "user.listed" }],
  ])("rejects %s", (_label, body) => {
    expect(parseAuditLogMessage(body)).toBeNull();
  });
});
