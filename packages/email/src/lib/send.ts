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

const resendClients = new Map<string, Resend>();

function getResendClient(apiKey: string): Resend {
  const cached = resendClients.get(apiKey);
  if (cached) {
    return cached;
  }
  const client = new Resend(apiKey);
  resendClients.set(apiKey, client);
  return client;
}

export async function sendEmail<T>(
  params: SendEmailParams<T>
): Promise<SendEmailResult> {
  const resend = getResendClient(params.apiKey);
  const { data, error } = await resend.emails.send({
    from: params.from,
    react: params.template(params.props),
    subject: params.subject,
    to: params.to,
  });

  if (error) {
    throw new Error(error.message, { cause: error });
  }

  return { messageId: data?.id, success: true };
}
