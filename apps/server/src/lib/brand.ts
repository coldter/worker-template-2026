import { type BrandConfig, getBrandConfig } from "@repo/shared/brand";

export function getBrandConfigFromBindings(
  env: CloudflareBindings
): BrandConfig {
  return getBrandConfig({
    APP_NAME: env.APP_NAME,
    APP_URL: env.APP_URL,
    BRAND_PRIMARY_COLOR: env.BRAND_PRIMARY_COLOR,
    COMPANY_NAME: env.COMPANY_NAME,
    LOGO_TEXT: env.LOGO_TEXT,
    SUPPORT_EMAIL: env.SUPPORT_EMAIL,
  });
}
