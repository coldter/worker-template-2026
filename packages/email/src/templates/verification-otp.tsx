import React from "react";
import { Heading, Section, Text } from "react-email";

import { BaseLayout } from "../components/base-layout";
import type { EmailBrandProps } from "../components/base-layout";

export interface VerificationOtpEmailProps {
  brand?: EmailBrandProps;
  expiresIn: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password";
  userName: string;
}

const TYPE_TITLES: Record<VerificationOtpEmailProps["type"], string> = {
  "email-verification": "Verify Your Email",
  "forget-password": "Reset Your Password",
  "sign-in": "Sign In Verification",
};

const TYPE_DESCRIPTIONS: Record<VerificationOtpEmailProps["type"], string> = {
  "email-verification":
    "Use the code below to verify your email address. If you did not create an account, you can safely ignore this email.",
  "forget-password":
    "Use the code below to reset your password. If you did not request a password reset, you can safely ignore this email.",
  "sign-in":
    "Use the code below to complete your sign-in. If you did not request this, you can safely ignore this email.",
};

export const VerificationOtpEmail = ({
  userName,
  otp,
  type,
  expiresIn,
  brand,
}: VerificationOtpEmailProps) => {
  const title = TYPE_TITLES[type];
  const description = TYPE_DESCRIPTIONS[type];

  return (
    <BaseLayout previewText={`Your verification code: ${otp}`} {...brand}>
      <Section>
        <Heading className="m-0 mb-6 text-center text-[28px] leading-tight font-bold text-slate-900">
          {title}
        </Heading>
        <Text className="m-0 mb-4 text-[16px] leading-relaxed text-slate-600">
          Hi {userName},
        </Text>
        <Text className="m-0 mb-6 text-[16px] leading-relaxed text-slate-600">
          {description}
        </Text>
        <Section className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
          <Text className="m-0 mb-2 text-[14px] text-slate-500">
            Your verification code is:
          </Text>
          <Text className="m-0 font-mono text-[36px] font-bold tracking-[0.3em] text-slate-900">
            {otp}
          </Text>
        </Section>
        <Text className="m-0 text-center text-[14px] leading-relaxed text-slate-500">
          This code will expire in <strong>{expiresIn}</strong>.
        </Text>
        <Text className="m-0 mt-4 text-center text-[14px] leading-relaxed text-slate-400">
          If you did not request this code, please ignore this email or contact
          support if you have concerns.
        </Text>
      </Section>
    </BaseLayout>
  );
};

VerificationOtpEmail.PreviewProps = {
  expiresIn: "10 minutes",
  otp: "123456",
  type: "forget-password",
  userName: "Ada",
} satisfies VerificationOtpEmailProps;
