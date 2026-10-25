import React from "react";
import { Button, Heading, Link, Section, Text } from "react-email";

import { BaseLayout } from "../components/base-layout";
import type { EmailBrandProps } from "../components/base-layout";

interface PasswordResetEmailProps {
  brand?: EmailBrandProps;
  expiresIn: string;
  resetUrl: string;
  userName: string;
}

export const PasswordResetEmail = ({
  userName,
  resetUrl,
  expiresIn,
  brand,
}: PasswordResetEmailProps) => (
  <BaseLayout previewText="Reset your password (link inside)." {...brand}>
    <Section>
      <Heading className="m-0 mb-6 text-center text-[28px] leading-tight font-bold text-slate-900">
        Reset your password
      </Heading>
      <Text className="m-0 mb-4 text-[16px] leading-relaxed text-slate-600">
        Hi {userName},
      </Text>
      <Text className="m-0 mb-8 text-[16px] leading-relaxed text-slate-600">
        We received a request to reset the password for your account. No
        worries—it happens to the best of us. This link will be active for the
        next <strong>{expiresIn}</strong>.
      </Text>
      <Section className="mb-8 text-center">
        <Button
          className="bg-brand-primary inline-block rounded-lg px-10 py-4 text-center text-[16px] font-bold text-white no-underline shadow-lg"
          href={resetUrl}
        >
          Reset Password
        </Button>
      </Section>
      <Section className="mb-6 rounded-lg border border-slate-100 bg-slate-50 p-4">
        <Text className="m-0 text-[13px] leading-relaxed text-slate-500">
          If you&apos;re having trouble with the button, copy and paste this
          link into your browser:
          <br />
          <Link className="text-brand-primary break-all" href={resetUrl}>
            {resetUrl}
          </Link>
        </Text>
      </Section>
      <Text className="m-0 text-center text-[14px] leading-relaxed text-slate-400">
        Didn&apos;t request this? You can safely ignore this email.
      </Text>
    </Section>
  </BaseLayout>
);

PasswordResetEmail.PreviewProps = {
  expiresIn: "60 minutes",
  resetUrl: "https://example.com/reset?token=abc123",
  userName: "Ada",
} satisfies PasswordResetEmailProps;
