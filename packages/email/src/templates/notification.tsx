import React from "react";
import { Button, Heading, Section, Text } from "react-email";

import { BaseLayout } from "../components/base-layout";
import type { EmailBrandProps } from "../components/base-layout";

interface NotificationEmailProps {
  actionLabel?: string;
  actionUrl?: string;
  body: string;
  brand?: EmailBrandProps;
  subject: string;
}

export const NotificationEmail = ({
  subject,
  body,
  actionUrl,
  actionLabel,
  brand,
}: NotificationEmailProps) => (
  <BaseLayout previewText={body.slice(0, 140)} {...brand}>
    <Section>
      <Heading className="m-0 mb-4 text-[24px] leading-tight font-bold text-slate-900">
        {subject}
      </Heading>
      <Text className="m-0 mb-6 text-[16px] leading-relaxed whitespace-pre-line text-slate-600">
        {body}
      </Text>
      {actionUrl ? (
        <Section className="mb-4 text-center">
          <Button
            className="bg-brand-primary inline-block rounded-lg px-8 py-3 text-center text-[16px] font-bold text-white no-underline"
            href={actionUrl}
          >
            {actionLabel ?? "View Details"}
          </Button>
        </Section>
      ) : null}
    </Section>
  </BaseLayout>
);

NotificationEmail.PreviewProps = {
  actionLabel: "View Invitation",
  actionUrl: "https://example.com/shares/123",
  body: "John wants to share a card ending in 4242 with you.",
  subject: "Card share invitation",
} satisfies NotificationEmailProps;
