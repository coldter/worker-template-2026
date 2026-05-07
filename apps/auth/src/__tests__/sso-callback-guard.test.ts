import type { Tenant } from "@repo/tenancy";
import type { HookEndpointContext } from "better-auth";
import { describe, expect, it, vi } from "vitest";

import { ssoCallbackGuardPlugin } from "../plugins/sso-callback-guard";

type MockDb = {
  query: {
    ssoProviders: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
};

function makeMockDb(providerRow: { organizationId: string } | null): MockDb {
  return {
    query: {
      ssoProviders: {
        findFirst: vi.fn().mockResolvedValue(providerRow),
      },
    },
  };
}

// Helper to build a minimal HookEndpointContext for matcher calls.
// The matcher only reads ctx.path, so context can be fully stubbed.
// boundary: vendor-SDK generic variance — HookEndpointContext requires a
// complex AuthContext; we only need ctx.path at runtime.
function hookCtx(path: string): HookEndpointContext {
  return { path } as unknown as HookEndpointContext;
}

const acmeTenant: Tenant = {
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain",
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
};

describe("ssoCallbackGuardPlugin", () => {
  it("has id 'sso-callback-guard'", () => {
    const db = makeMockDb(null);
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    expect(plugin.id).toBe("sso-callback-guard");
  });

  it("has a before hook array", () => {
    const db = makeMockDb(null);
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    expect(Array.isArray(plugin.hooks?.before)).toBe(true);
    expect(plugin.hooks?.before?.length).toBeGreaterThan(0);
  });

  it("matcher returns true for /sso/callback/some-provider", () => {
    const db = makeMockDb(null);
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sso/callback/prov_test");
    expect(hooks.some((h) => h.matcher(ctx))).toBe(true);
  });

  it("matcher returns false for /sign-in/email", () => {
    const db = makeMockDb(null);
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sign-in/email");
    expect(hooks.some((h) => h.matcher(ctx))).toBe(false);
  });

  it("rejects cross-tenant callback (provider.organizationId !== tenant.organizationId)", async () => {
    // Provider belongs to org_other, but tenant is org_acme
    const db = makeMockDb({ organizationId: "org_other" });
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sso/callback/prov_attacker");
    const hook = hooks.find((h) => h.matcher(ctx));
    if (!hook) {
      throw new Error("No matching hook");
    }
    // Invoke the handler — it should throw with 403
    await expect(
      (hook.handler as unknown as (ctx: unknown) => Promise<unknown>)(ctx)
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Provider does not belong to this tenant",
    });
  });

  it("rejects when provider is not found in DB", async () => {
    const db = makeMockDb(null); // no provider row
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sso/callback/prov_unknown");
    const hook = hooks.find((h) => h.matcher(ctx));
    if (!hook) {
      throw new Error("No matching hook");
    }
    await expect(
      (hook.handler as unknown as (ctx: unknown) => Promise<unknown>)(ctx)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects all callbacks when tenant is null (admin/apex host)", async () => {
    const db = makeMockDb({ organizationId: "org_acme" });
    // tenant is null — admin host
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      null
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sso/callback/prov_test");
    const hook = hooks.find((h) => h.matcher(ctx));
    if (!hook) {
      throw new Error("No matching hook");
    }
    await expect(
      (hook.handler as unknown as (ctx: unknown) => Promise<unknown>)(ctx)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("passes when provider.organizationId matches tenant.organizationId", async () => {
    const db = makeMockDb({ organizationId: "org_acme" });
    const plugin = ssoCallbackGuardPlugin(
      db as unknown as Parameters<typeof ssoCallbackGuardPlugin>[0],
      acmeTenant
    );
    const hooks = plugin.hooks?.before ?? [];
    const ctx = hookCtx("/sso/callback/prov_acme_sso");
    const hook = hooks.find((h) => h.matcher(ctx));
    if (!hook) {
      throw new Error("No matching hook");
    }
    await expect(
      (hook.handler as unknown as (ctx: unknown) => Promise<unknown>)(ctx)
    ).resolves.toBeUndefined();
  });
});
