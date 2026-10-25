import { BRAND_DEFAULTS } from "@repo/shared/brand";
import React from "react";
import { Section, Text } from "react-email";

interface EmailLogoProps {
  appName?: string;
}

export const EmailLogo = ({
  appName = BRAND_DEFAULTS.appName,
}: EmailLogoProps) => (
  <Section className="mb-8">
    <Section className="flex items-center justify-center">
      <div className="rounded-lg bg-black px-3 py-1">
        <Text className="m-0 text-xl leading-none font-bold tracking-tight text-white">
          {appName.toUpperCase()}
        </Text>
      </div>
    </Section>
  </Section>
);
