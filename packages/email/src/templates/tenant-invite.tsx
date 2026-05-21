import { Button, Heading, Section, Text } from "@react-email/components";
import React from "react";
import { BaseLayout } from "../components/base-layout";

export interface TenantInviteEmailProps {
  acceptUrl: string;
  expiresInHours: number;
  inviterName?: string | null;
  organizationName: string;
}

export function TenantInviteEmail({
  acceptUrl,
  organizationName,
  inviterName,
  expiresInHours,
}: TenantInviteEmailProps) {
  const inviter = inviterName?.trim() || "your platform operator";
  return (
    <BaseLayout
      previewText={`You've been invited to administer ${organizationName}`}
    >
      <Section>
        <Heading className="text-[28px] font-bold text-slate-900 text-center m-0 mb-6 leading-tight">
          Welcome to {organizationName}
        </Heading>
        <Text className="text-[16px] text-slate-600 leading-relaxed m-0 mb-6">
          {inviter} invited you to administer the {organizationName} workspace.
          Click the button below to set your password and accept the invitation.
          The link expires in {expiresInHours} hours.
        </Text>
        <Section className="text-center mb-8">
          <Button
            className="bg-brand-primary text-white text-[16px] font-bold no-underline text-center px-10 py-4 rounded-lg inline-block shadow-lg"
            href={acceptUrl}
          >
            Accept invitation
          </Button>
        </Section>
        <Text className="text-[14px] text-slate-500 leading-relaxed m-0">
          If you weren't expecting this invitation, you can safely ignore this
          email — no account will be created until you accept.
        </Text>
      </Section>
    </BaseLayout>
  );
}

TenantInviteEmail.PreviewProps = {
  acceptUrl: "https://acme.app.example.com/accept-invite/inv_demo",
  organizationName: "Acme Co",
  inviterName: "Operations team",
  expiresInHours: 48,
} satisfies TenantInviteEmailProps;

export default TenantInviteEmail;
