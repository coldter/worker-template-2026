import { BRAND_DEFAULTS } from "@repo/shared/brand";
import React from "react";
import { Hr, Link, Section, Text } from "react-email";

const CURRENT_YEAR = new Date().getFullYear();

interface EmailFooterProps {
  companyAddress?: string;
  companyName?: string;
  supportEmail?: string;
}

export const EmailFooter = ({
  companyName = BRAND_DEFAULTS.companyName,
  companyAddress = "123 Street Address, City, State 12345",
  supportEmail = BRAND_DEFAULTS.supportEmail,
}: EmailFooterProps) => (
  <Section className="mt-8">
    <Hr className="mb-6 border-slate-200" />
    <Text className="mb-2 text-center text-[12px] leading-relaxed text-slate-500">
      Questions? We&apos;re here to help. Contact us at{" "}
      <Link className="text-blue-600 underline" href={`mailto:${supportEmail}`}>
        {supportEmail}
      </Link>
    </Text>
    <Text className="m-0 text-center text-[12px] font-semibold tracking-wider text-slate-400 uppercase">
      &copy; {CURRENT_YEAR} {companyName}
    </Text>
    <Text className="m-0 mt-1 text-center text-[12px] text-slate-400">
      {companyAddress}
    </Text>
  </Section>
);
