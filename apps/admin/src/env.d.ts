/// <reference types="@cloudflare/workers-types" />
import type { DrizzleClient } from "@repo/db";
import type { GlobalAdmin } from "@repo/db/schema";
import type { AdminApiBindingRpc } from "@repo/shared/api-binding";

export type AdminBindings = {
  HYPERDRIVE: Hyperdrive;
  CACHE: KVNamespace;
  ADMIN_UI: Fetcher;
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
    globalAdmin: GlobalAdmin;
    createTenantBody?: {
      slug: string;
      name: string;
      primaryAdminEmail: string;
    };
  };
};
