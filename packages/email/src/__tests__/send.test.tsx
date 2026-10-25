import { beforeEach, describe, expect, it } from "vitest";

import { createEmailSender } from "../lib/send";
import type { EmailClient } from "../lib/send";

type SendResponse =
  | { kind: "ok"; data: { id: string } }
  | { kind: "apiError"; message: string }
  | { kind: "throw"; error: Error };

const sendQueue: SendResponse[] = [];

const clientApiKeys: string[] = [];

const createFakeClient = (apiKey: string): EmailClient => {
  clientApiKeys.push(apiKey);

  return {
    emails: {
      send: () => {
        const next = sendQueue.shift();

        if (!next) {
          return Promise.resolve({
            data: { id: "msg_default" },
            error: null,
          });
        }

        if (next.kind === "throw") {
          return Promise.reject(next.error);
        }

        if (next.kind === "apiError") {
          return Promise.resolve({
            data: null,
            error: { message: next.message },
          });
        }

        return Promise.resolve({ data: next.data, error: null });
      },
    },
  };
};

interface DummyProps {
  name: string;
}

const DummyTemplate = ({ name }: DummyProps) => <div>Hello {name}</div>;

describe("sendEmail", () => {
  beforeEach(() => {
    clientApiKeys.length = 0;
    sendQueue.length = 0;
  });

  it("returns success on a successful send", async () => {
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

    expect(result).toStrictEqual({ messageId: "msg_123", success: true });
    expect(clientApiKeys).toStrictEqual(["key-success"]);
  });

  it("caches Resend clients per apiKey", async () => {
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

    expect(clientApiKeys).toStrictEqual(["key-a", "key-b"]);
  });

  it("throws on a Resend API error", async () => {
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

  it("propagates thrown errors from the Resend client", async () => {
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
