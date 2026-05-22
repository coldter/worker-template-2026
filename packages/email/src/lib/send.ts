import type { ReactElement } from "react";
import { Resend } from "resend";

export interface SendEmailResult {
  error?: Error;
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

// Per-isolate cache: amortises client construction across requests in the same Worker isolate.
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
  try {
    const resend = getResendClient(params.apiKey);
    const { error } = await resend.emails.send({
      from: params.from,
      to: params.to,
      subject: params.subject,
      react: params.template(params.props),
    });

    if (error) {
      return { success: false, error: new Error(error.message) };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
