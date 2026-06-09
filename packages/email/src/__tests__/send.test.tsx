import { beforeEach, describe, expect, test, vi } from "vitest";

// Responses the next `emails.send` invocations produce; empty defaults to
// success. Tests push here before invoking `sendEmail`.
type SendResponse =
  | { kind: "ok"; data: { id: string } }
  | { kind: "apiError"; message: string }
  | { kind: "throw"; error: Error };

const sendQueue: SendResponse[] = [];

// Track every Resend instance constructed so we can assert on the
// module-level constructor cache.
const resendInstances: Array<{ apiKey: string }> = [];

vi.mock("resend", () => {
  class Resend {
    apiKey: string;
    emails: {
      send: (args: unknown) => Promise<{
        data: { id: string } | null;
        error: { name: string; message: string } | null;
      }>;
    };

    constructor(apiKey: string) {
      this.apiKey = apiKey;
      resendInstances.push({ apiKey });
      this.emails = {
        send: async () => {
          const next = sendQueue.shift();
          if (!next) {
            return { data: { id: "msg_default" }, error: null };
          }
          if (next.kind === "throw") {
            throw next.error;
          }
          if (next.kind === "apiError") {
            return {
              data: null,
              error: { name: "validation_error", message: next.message },
            };
          }
          return { data: next.data, error: null };
        },
      };
    }
  }
  return { Resend };
});

interface DummyProps {
  name: string;
}

function DummyTemplate({ name }: DummyProps) {
  return <div>Hello {name}</div>;
}

beforeEach(() => {
  resendInstances.length = 0;
  sendQueue.length = 0;
  // Reset the modules so the module-scoped `resendClients` cache in
  // `lib/send.ts` starts empty for each test. The mocked `resend` module is
  // re-evaluated alongside it, but the captured `sendQueue` and
  // `resendInstances` arrays stay shared via closure.
  vi.resetModules();
});

describe("sendEmail", () => {
  test("returns success on a successful send", async () => {
    sendQueue.push({ kind: "ok", data: { id: "msg_123" } });
    const { sendEmail } = await import("../lib/send");

    const result = await sendEmail<DummyProps>({
      apiKey: "key-success",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Hi",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(result).toEqual({ success: true });
    expect(resendInstances).toHaveLength(1);
    expect(resendInstances[0]?.apiKey).toBe("key-success");
  });

  test("caches Resend clients per apiKey", async () => {
    const { sendEmail } = await import("../lib/send");

    await sendEmail<DummyProps>({
      apiKey: "key-cached",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "First",
      template: DummyTemplate,
      to: "ada@example.com",
    });
    await sendEmail<DummyProps>({
      apiKey: "key-cached",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Second",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    // Only one Resend was constructed despite two sends, proving the
    // module-scoped cache returned the same instance for the shared key.
    expect(resendInstances).toHaveLength(1);
  });

  test("constructs a new Resend per distinct apiKey", async () => {
    const { sendEmail } = await import("../lib/send");

    await sendEmail<DummyProps>({
      apiKey: "key-a",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "A",
      template: DummyTemplate,
      to: "ada@example.com",
    });
    await sendEmail<DummyProps>({
      apiKey: "key-b",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "B",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(resendInstances).toHaveLength(2);
    expect(resendInstances[0]?.apiKey).toBe("key-a");
    expect(resendInstances[1]?.apiKey).toBe("key-b");
  });

  test("surfaces a Resend API error in the result", async () => {
    sendQueue.push({ kind: "apiError", message: "Invalid recipient" });
    const { sendEmail } = await import("../lib/send");

    const result = await sendEmail<DummyProps>({
      apiKey: "key-error",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Boom",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected failure result");
    }
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("Invalid recipient");
  });

  test("catches thrown errors from the Resend client", async () => {
    sendQueue.push({ kind: "throw", error: new Error("network down") });
    const { sendEmail } = await import("../lib/send");

    const result = await sendEmail<DummyProps>({
      apiKey: "key-throws",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Boom",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected failure result");
    }
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("network down");
  });
});
