import type { ReactElement } from "react";
import { Resend } from "resend";
import type { SendEmailResult } from "../transports/types";

export interface SendEmailParams<T> {
  apiKey: string;
  from: string;
  props: T;
  subject: string;
  template: (props: T) => ReactElement;
  to: string | string[];
}

export async function sendEmail<T>(
  params: SendEmailParams<T>
): Promise<SendEmailResult> {
  try {
    const resend = new Resend(params.apiKey);
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
