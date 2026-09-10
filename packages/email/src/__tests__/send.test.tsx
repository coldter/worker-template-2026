import { beforeEach, describe, expect, test } from "vitest";
import { createEmailSender, type EmailClient } from "../lib/send";

type SendResponse =
  | { kind: "ok"; data: { id: string } }
  | { kind: "apiError"; message: string }
  | { kind: "throw"; error: Error };

const sendQueue: SendResponse[] = [];

const clientApiKeys: string[] = [];

function createFakeClient(apiKey: string): EmailClient {
  clientApiKeys.push(apiKey);
  return {
    emails: {
      send: async () => {
        const next = sendQueue.shift();
        if (!next) {
          return { data: { id: "msg_default" }, error: null };
        }
        if (next.kind === "throw") {
          throw next.error;
        }
        if (next.kind === "apiError") {
          return { data: null, error: { message: next.message } };
        }
        return { data: next.data, error: null };
      },
    },
  };
}

interface DummyProps {
  name: string;
}

function DummyTemplate({ name }: DummyProps) {
  return <div>Hello {name}</div>;
}

beforeEach(() => {
  clientApiKeys.length = 0;
  sendQueue.length = 0;
});

describe("sendEmail", () => {
  test("returns success on a successful send", async () => {
    sendQueue.push({ data: { id: "msg_123" }, kind: "ok" });
    const sendEmail = createEmailSender(createFakeClient);

    const result = await sendEmail<DummyProps>({
      apiKey: "key-success",
      from: "noreply@example.com",
      props: { name: "Ada" },
      subject: "Hi",
      template: DummyTemplate,
      to: "ada@example.com",
    });

    expect(result).toEqual({ messageId: "msg_123", success: true });
    expect(clientApiKeys).toEqual(["key-success"]);
  });

  test("caches Resend clients per apiKey", async () => {
    const sendEmail = createEmailSender(createFakeClient);

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

    expect(clientApiKeys).toEqual(["key-a", "key-b"]);
  });

  test("throws on a Resend API error", async () => {
    sendQueue.push({ kind: "apiError", message: "Invalid recipient" });
    const sendEmail = createEmailSender(createFakeClient);

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
    const sendEmail = createEmailSender(createFakeClient);

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
