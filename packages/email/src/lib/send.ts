import type { ReactElement } from "react";
import { Resend } from "resend";

export interface SendEmailResult {
  messageId?: string;
  success: boolean;
}

export interface SendEmailParams<T> {
  apiKey: string;
  from: string;
  props: T;
  subject: string;
  template: (props: T) => ReactElement;
  to: string | string[];
}

export interface EmailSendResponse {
  data: { id: string } | null;
  error: { message: string } | null;
}

export interface EmailClient {
  emails: {
    send: (params: {
      from: string;
      react: ReactElement;
      subject: string;
      to: string | string[];
    }) => Promise<EmailSendResponse>;
  };
}

export type EmailClientFactory = (apiKey: string) => EmailClient;

export function createEmailSender(createClient: EmailClientFactory) {
  const clients = new Map<string, EmailClient>();

  const getClient = (apiKey: string): EmailClient => {
    const cached = clients.get(apiKey);
    if (cached) {
      return cached;
    }
    const client = createClient(apiKey);
    clients.set(apiKey, client);
    return client;
  };

  return async function sendEmail<T>(
    params: SendEmailParams<T>
  ): Promise<SendEmailResult> {
    const client = getClient(params.apiKey);
    const { data, error } = await client.emails.send({
      from: params.from,
      react: params.template(params.props),
      subject: params.subject,
      to: params.to,
    });

    if (error) {
      throw new Error(error.message, { cause: error });
    }

    return { messageId: data?.id, success: true };
  };
}

export const sendEmail = createEmailSender((apiKey) => new Resend(apiKey));
