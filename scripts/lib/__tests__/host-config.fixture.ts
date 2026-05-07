// Test fixtures for the host-config generator. Two snapshots — a baseline
// `example.com` rooted set and a flipped `mycoolsaas.dev` rooted set — are
// used by the setup-env / check-hosts / config-flip tests so we can assert
// that every derived value re-emits without source edits when the root .env
// changes (A7.11 regression).

import type { RootHostEnv } from "../host-config";

export const BASELINE_FIXTURE: RootHostEnv = Object.freeze({
  rootDomain: "example.com",
  appWildcardHost: "app.example.com",
  adminHost: "admin.example.com",
  fallbackHost: "fallback.example.com",
  customHostCnameTarget: "customers.example.com",
  customHostVerificationLabel: "_app-example-verify",
  brandingHost: "branding.example.com",
  localAppWildcardHost: "app.lvh.me",
  localAdminHost: "admin.lvh.me",
  localFallbackHost: "fallback.lvh.me",
  defaultDevTenantSlug: "acme",
  defaultDevCustomHost: "",
});

export const FLIPPED_FIXTURE: RootHostEnv = Object.freeze({
  rootDomain: "mycoolsaas.dev",
  appWildcardHost: "tenants.mycoolsaas.dev",
  adminHost: "ops.mycoolsaas.dev",
  fallbackHost: "fallback.mycoolsaas.dev",
  customHostCnameTarget: "edge.mycoolsaas.dev",
  customHostVerificationLabel: "_mycoolsaas-verify",
  brandingHost: "brand.mycoolsaas.dev",
  localAppWildcardHost: "tenants.local.test",
  localAdminHost: "ops.local.test",
  localFallbackHost: "fallback.local.test",
  defaultDevTenantSlug: "alpha",
  defaultDevCustomHost: "",
});
