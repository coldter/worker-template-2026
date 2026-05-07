import { Button, Heading, Section, Text } from "@react-email/components";
import React from "react";
import { BaseLayout } from "../components/base-layout";

/**
 * B2 — operator-led tenant admin invitation. Sent after the operator submits
 * `POST /api/admin/tenants`. The button points at the tenant SPA's
 * `/accept-invite/:invitationId` route (B4), where the user supplies a name
 * and password to claim their primary-admin seat. Per D60 the SPA accept
 * flow recovers from BA's `USER_ALREADY_EXISTS` so existing users can be
 * auto-linked when they click the same link.
 */
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
