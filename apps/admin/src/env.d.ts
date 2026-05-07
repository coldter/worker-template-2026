/// <reference types="@cloudflare/workers-types" />
import type { DrizzleClient } from "@repo/db";
import type { GlobalAdmin } from "@repo/db/schema";
import type { AdminApiBindingRpc } from "@repo/shared/api-binding";

export type AdminBindings = {
  HYPERDRIVE: Hyperdrive;
  CACHE: KVNamespace;
  // B3 wires the admin-ui ASSETS binding (D63). The admin worker serves the
  // admin-ui SPA bundle (../admin-ui/dist) for non-/api/* requests via SPA
  // fallback in apps/admin/src/server.ts.
  ADMIN_UI: Fetcher;
  // The server worker entrypoint. Typed as Fetcher intersected with the
  // AdminApiBindingRpc surface that AdminApiEntrypoint exposes (B2 / D35).
  API: Fetcher & AdminApiBindingRpc;
  AUTH: Fetcher;
  NODE_ENV: string;
  ADMIN_HOST: string;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  ALLOW_DEV_ADMIN_AUTH?: string;
  LOCAL_DEV_ADMIN_EMAIL?: string;
};

export type AccessIdentity = {
  sub: string;
  email: string;
};

export type AdminEnv = {
  Bindings: AdminBindings;
  Variables: {
    db: DrizzleClient;
    accessIdentity: AccessIdentity;
    // Set by `cfAccessMiddleware` exclusively. Production traffic resolves
    // through `authenticateOperator` (JWT `sub` lookup); the dev-mode short
    // circuit resolves through `authenticateOperatorByEmail` (seeded
    // `LOCAL_DEV_ADMIN_EMAIL`). Both paths share the same finalize step.
    globalAdmin: GlobalAdmin;
    // Per-handler scratch slots for parsed bodies (avoids re-parsing JSON).
    createTenantBody?: {
      slug: string;
      name: string;
      primaryAdminEmail: string;
    };
  };
};
