// Uses `style.setProperty` so we never have to inject a `<style>` tag, which
// would require relaxing CSP to `'unsafe-inline'`.
import type { TenantInfo } from "./tenant";

export function applyBranding(branding: TenantInfo["branding"]): void {
  if (branding.primaryColor) {
    document.documentElement.style.setProperty(
      "--brand-primary",
      branding.primaryColor
    );
  }
  document.title = branding.appName;
}
