import { describe, expect, it, vi } from "vitest";

// The workers vitest pool cannot load pg's CJS internals; queue.ts reaches it
// via @repo/db, which the DLQ consumer never touches at runtime.
vi.mock("pg", () => ({ Client: class {}, default: {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

import { handleAuditLogDlq } from "@/modules/audit-logs/queue";

function makeMessage(body: unknown) {
  return {
    ack: vi.fn(),
    attempts: 4,
    body,
    id: "msg_1",
    retry: vi.fn(),
    timestamp: new Date("2026-06-11T00:00:00.000Z"),
  };
}

describe("handleAuditLogDlq", () => {
  it("acks every message and never retries, even malformed ones", async () => {
    const messages = [
      makeMessage({
        event: "user.listed",
        occurredAt: "2026-06-09T00:00:00.000Z",
      }),
      makeMessage("not even an object"),
    ];
    const ackAll = vi.fn();
    // boundary: test fixture reflection - minimal MessageBatch stub.
    const batch = {
      ackAll,
      messages,
      queue: "audit-log-dlq",
      retryAll: vi.fn(),
    } as unknown as MessageBatch;

    // boundary: test fixture reflection - the DLQ consumer touches no bindings.
    await handleAuditLogDlq(
      batch,
      {} as CloudflareBindings,
      {} as ExecutionContext
    );

    expect(ackAll).toHaveBeenCalledTimes(1);
    for (const message of messages) {
      expect(message.retry).not.toHaveBeenCalled();
    }
  });
});
