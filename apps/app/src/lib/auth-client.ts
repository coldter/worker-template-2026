// `baseURL: window.location.origin` is intentional — every tenant has its
// own origin (subdomain or custom hostname), so cookies stay scoped to the
// tenant. A build-time env var would force one origin and break per-tenant
// cookies.
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
