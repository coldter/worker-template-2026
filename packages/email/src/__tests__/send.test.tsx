import { beforeEach, describe, expect, test, vi } from "vitest";

type SendResponse =
  | { kind: "ok"; data: { id: string } }
  | { kind: "apiError"; message: string }
  | { kind: "throw"; error: Error };

const sendQueue: SendResponse[] = [];

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
              error: { message: next.message, name: "validation_error" },
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

  vi.resetModules();
});

describe("sendEmail", () => {
  test("returns success on a successful send", async () => {
    sendQueue.push({ data: { id: "msg_123" }, kind: "ok" });
    const { sendEmail } = await import("../lib/send");

    const result = await sendEmail<DummyProps>({
      apiKey: "key-success",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Hi",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(result).toEqual({ messageId: "msg_123", success: true });
    expect(resendInstances).toHaveLength(1);
    expect(resendInstances[0]?.apiKey).toBe("key-success");
  });

  test("caches Resend clients per apiKey", async () => {
    const { sendEmail } = await import("../lib/send");

    await sendEmail<DummyProps>({
      apiKey: "key-a",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "First",
      template: DummyTemplate,
      to: "ada@example.com",
    });
    await sendEmail<DummyProps>({
      apiKey: "key-a",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Second",
      template: DummyTemplate,
      to: "ada@example.com",
    });
    await sendEmail<DummyProps>({
      apiKey: "key-b",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Third",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(resendInstances).toEqual([{ apiKey: "key-a" }, { apiKey: "key-b" }]);
  });

  test("throws on a Resend API error", async () => {
    sendQueue.push({ kind: "apiError", message: "Invalid recipient" });
    const { sendEmail } = await import("../lib/send");

    await expect(
      sendEmail<DummyProps>({
        apiKey: "key-error",
        from: "noreply@example.com",
        props: { name: "Ada" },
        subject: "Boom",
        template: DummyTemplate,
        to: "ada@example.com",
      })
    ).rejects.toThrow("Invalid recipient");
  });

  test("propagates thrown errors from the Resend client", async () => {
    sendQueue.push({ error: new Error("network down"), kind: "throw" });
    const { sendEmail } = await import("../lib/send");

    await expect(
      sendEmail<DummyProps>({
        apiKey: "key-throws",
        from: "noreply@example.com",
        props: { name: "Ada" },
        subject: "Boom",
        template: DummyTemplate,
        to: "ada@example.com",
      })
    ).rejects.toThrow("network down");
  });
});
