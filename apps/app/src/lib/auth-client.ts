// Better Auth tenant client (D44, D47).
//
// `baseURL: window.location.origin` is intentional — every tenant has its
// own origin (subdomain or custom hostname), so cookies stay scoped to the
// tenant. A build-time env var would force one origin and break per-tenant
// cookies. Plugins mirror the server-side BA configuration:
//   - organizationClient — invitations, member management.
//   - twoFactorClient    — TOTP enrol/verify.
//   - ssoClient          — tenant SSO sign-in (D44).
import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/client";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [organizationClient(), twoFactorClient(), ssoClient()],
});
