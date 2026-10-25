import { describe, expect, it, vi } from "vitest";

import { handleAuditLogDlq } from "@/modules/audit-logs/queue";
import type { AuditLogQueueMessageBody } from "@/modules/audit-logs/queue-message";

const makeMessage = (body: AuditLogQueueMessageBody) => ({
  ack: vi.fn<() => void>(),
  attempts: 4,
  body,
  id: "msg_1",
  retry: vi.fn<() => void>(),
  timestamp: new Date("2026-06-11T00:00:00.000Z"),
});

describe(handleAuditLogDlq, () => {
  it("acks every message and never retries, even malformed ones", async () => {
    const messages = [
      makeMessage({
        event: "user.listed",
        occurredAt: "2026-06-09T00:00:00.000Z",
      }),
      makeMessage("not even an object"),
    ];

    const ackAll = vi.fn<() => void>();

    const batch: MessageBatch = {
      ackAll,
      messages,
      metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
      queue: "audit-log-dlq",
      retryAll: vi.fn<() => void>(),
    };

    // SAFETY: handleAuditLogDlq ignores env and ctx, so empty stand-ins exercise only the batch handling under test.
    const [unusedEnv, unusedCtx] = [
      {} as CloudflareBindings,
      {} as ExecutionContext,
    ];

    await handleAuditLogDlq(batch, unusedEnv, unusedCtx);

    expect(ackAll).toHaveBeenCalledOnce();

    for (const message of messages) {
      expect(message.retry).not.toHaveBeenCalled();
    }
  });
});
