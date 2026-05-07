import { generatePrefixedCuid, ID_PREFIXES } from "@repo/db/ids";

/**
 * A5 TXT pre-verification token (D14). The token is what the tenant places as
 * a TXT record at `${CUSTOM_HOST_VERIFICATION_LABEL}.<host>` to prove control
 * of the domain BEFORE we touch the Cloudflare-for-SaaS API.
 */
export function generateVerificationToken(): `vtok_${string}` {
  return generatePrefixedCuid(ID_PREFIXES.verificationToken);
}
