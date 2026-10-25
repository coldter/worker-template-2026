import React from "react";
import { Heading, Section, Text } from "react-email";

import { BaseLayout } from "../components/base-layout";
import type { EmailBrandProps } from "../components/base-layout";

export interface TwoFactorOtpEmailProps {
  brand?: EmailBrandProps;
  expiresIn: string;
  ipAddress?: string;
  otp: string;
  userAgent?: string;
  userName: string;
}

export const TwoFactorOtpEmail = ({
  userName,
  otp,
  expiresIn,
  ipAddress,
  userAgent,
  brand,
}: TwoFactorOtpEmailProps) => (
  <BaseLayout previewText={`Your 2FA code: ${otp}`} {...brand}>
    <Section>
      <Heading className="m-0 mb-6 text-center text-[28px] leading-tight font-bold text-slate-900">
        Two-Factor Authentication
      </Heading>
      <Text className="m-0 mb-4 text-[16px] leading-relaxed text-slate-600">
        Hi {userName},
      </Text>
      <Text className="m-0 mb-6 text-[16px] leading-relaxed text-slate-600">
        A sign-in attempt requires verification. Use the code below to complete
        your login.
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
      {(ipAddress || userAgent) && (
        <Section className="mt-6 rounded-lg border border-slate-100 bg-slate-50 p-4">
          <Text className="m-0 text-[13px] leading-relaxed text-slate-500">
            <strong>Sign-in attempt details:</strong>
            {ipAddress && (
              <>
                <br />
                IP Address: {ipAddress}
              </>
            )}
            {userAgent && (
              <>
                <br />
                Device: {userAgent}
              </>
            )}
          </Text>
        </Section>
      )}
      <Text className="m-0 mt-6 text-center text-[14px] leading-relaxed text-slate-400">
        If you did not attempt to sign in, please secure your account
        immediately by changing your password.
      </Text>
    </Section>
  </BaseLayout>
);

TwoFactorOtpEmail.PreviewProps = {
  expiresIn: "3 minutes",
  ipAddress: "192.168.1.1",
  otp: "123456",
  userAgent: "Chrome on macOS",
  userName: "Ada",
} satisfies TwoFactorOtpEmailProps;
