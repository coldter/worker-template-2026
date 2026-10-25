import React from "react";
import { Button, Heading, Section, Text } from "react-email";

import { BaseLayout } from "../components/base-layout";
import type { EmailBrandProps } from "../components/base-layout";

interface WelcomeEmailProps {
  brand?: EmailBrandProps;
  loginUrl: string;
  userName: string;
}

export const WelcomeEmail = ({
  userName,
  loginUrl,
  brand,
}: WelcomeEmailProps) => (
  <BaseLayout previewText="Welcome aboard! Your account is ready." {...brand}>
    <Section>
      <Heading className="m-0 mb-6 text-center text-[28px] leading-tight font-bold text-slate-900">
        Welcome, {userName}!
      </Heading>
      <Text className="m-0 mb-6 text-[16px] leading-relaxed text-slate-600">
        We&apos;re thrilled to have you here. Your account is fully set up and
        ready to go. Dive in and start exploring your new dashboard today.
      </Text>
      <Section className="mb-8 text-center">
        <Button
          className="bg-brand-primary inline-block rounded-lg px-10 py-4 text-center text-[16px] font-bold text-white no-underline shadow-lg"
          href={loginUrl}
        >
          Get Started
        </Button>
      </Section>
    </Section>
  </BaseLayout>
);

WelcomeEmail.PreviewProps = {
  loginUrl: "https://example.com/login",
  userName: "Ada",
} satisfies WelcomeEmailProps;
