import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { ACTOR_TYPES, AUDIT_EVENTS, TARGET_TYPES } from "@repo/shared/audit";
import { logger } from "@repo/shared/logger";
import type { FanOutInvalidator, Tenant } from "@repo/tenancy";
import { eq, sql } from "drizzle-orm";
import type { AuditContext } from "@/lib/audit-context";
import type { AppBindings } from "@/lib/context";
import { auditLogService } from "@/modules/audit-logs/service";
import {
  type OidcConfig,
  type SsoProviderPublic,
  ssoProviderRepository,
} from "./repository";
import type { CreateSsoProviderBody, UpdateSsoProviderBody } from "./schema";

export type SsoProviderRow = SsoProviderPublic;

/**
 * A4.4 — extract the issuer origin to register with the auth worker after
 * createSsoProvider commits. Prefers an explicit `discoveryEndpoint` (the
 * URL OIDC discovery actually fires against) over the `issuer` field. The
 * auth worker performs final validation and normalizes deeper OIDC discovery
 * paths to their URL origin.
 */
function pickIssuerForRegistration(
  body: CreateSsoProviderBody | UpdateSsoProviderBody
): string | null {
  if (!(body.issuer || "oidcConfig" in body)) {
    return null;
  }
  const discovery =
    "oidcConfig" in body ? body.oidcConfig?.discoveryEndpoint : null;
  if (discovery && typeof discovery === "string") {
    return discovery;
  }
  return body.issuer ?? null;
}

export async function createSsoProvider(
  db: DrizzleClient,
  env: AppBindings,
  tenant: Tenant,
  body: CreateSsoProviderBody,
  actorId: string,
  auditCtx: AuditContext
): Promise<SsoProviderRow> {
  const provider = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.sso_key = ${env.SSO_KEY}`);
    const created = await ssoProviderRepository.create(tx, {
      issuer: body.issuer,
      domain: body.domain,
      providerId: body.providerId,
      // organizationId ALWAYS comes from the resolved tenant — never from the body
      organizationId: tenant.organizationId,
      oidcConfig: body.oidcConfig,
      userId: actorId,
    });
    await auditLogService.create(
      {
        event: AUDIT_EVENTS.SSO.PROVIDER_CREATED.event,
        actorId,
        actorType: ACTOR_TYPES.USER,
        targetId: created.id,
        targetType: TARGET_TYPES.SSO_PROVIDER,
        ipAddress: auditCtx.ipAddress,
        userAgent: auditCtx.userAgent,
        metadata: { organizationId: tenant.organizationId },
      },
      tx
    );
    return created;
  });

  // A4.4 — after the tx commits, register the validated issuer origin with
  // the auth worker so subsequent /sso/sign-in redirects pass BA's
  // allowed-redirect check. Failure is non-fatal: the snapshot is best-effort
  // and a cold isolate without it just falls back to the auto-merged
  // allowedHosts list. We log via the structured logger rather than throw so
  // a transient RPC error does not roll back the persisted provider row.
  try {
    const issuerForRegistration = pickIssuerForRegistration(body);
    if (issuerForRegistration) {
      await env.AUTH.registerTrustedOrigin(
        tenant.organizationId,
        issuerForRegistration
      );
    }
  } catch (error) {
    logger.warn("registerTrustedOrigin RPC failed", {
      organizationId: tenant.organizationId,
      providerId: provider.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return provider;
}

export async function listSsoProviders(
  db: DrizzleClient,
  tenant: Tenant
): Promise<SsoProviderRow[]> {
  return ssoProviderRepository.findByOrg(db, tenant.organizationId);
}

export async function updateSsoProvider(
  db: DrizzleClient,
  env: AppBindings,
  tenant: Tenant,
  providerId: string,
  body: UpdateSsoProviderBody,
  actorId: string,
  auditCtx: AuditContext
): Promise<SsoProviderRow | null> {
  const updated = await db.transaction(async (tx) => {
    const updated = await ssoProviderRepository.updateMetadata(
      tx,
      tenant.organizationId,
      providerId,
      body
    );
    if (!updated) {
      return null;
    }
    await auditLogService.create(
      {
        event: AUDIT_EVENTS.SSO.PROVIDER_UPDATED.event,
        actorId,
        actorType: ACTOR_TYPES.USER,
        targetId: providerId,
        targetType: TARGET_TYPES.SSO_PROVIDER,
        ipAddress: auditCtx.ipAddress,
        userAgent: auditCtx.userAgent,
        metadata: { organizationId: tenant.organizationId },
      },
      tx
    );
    return updated;
  });

  const issuerForRegistration = pickIssuerForRegistration(body);
  if (updated && issuerForRegistration) {
    try {
      await env.AUTH.registerTrustedOrigin(
        tenant.organizationId,
        issuerForRegistration
      );
    } catch (error) {
      logger.warn("registerTrustedOrigin RPC after update failed", {
        organizationId: tenant.organizationId,
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return updated;
}

export async function deleteSsoProvider(
  db: DrizzleClient,
  tenant: Tenant,
  providerId: string,
  actorId: string,
  auditCtx: AuditContext
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await ssoProviderRepository.remove(
      tx,
      tenant.organizationId,
      providerId
    );
    if (!removed) {
      return false;
    }
    await auditLogService.create(
      {
        event: AUDIT_EVENTS.SSO.PROVIDER_DELETED.event,
        actorId,
        actorType: ACTOR_TYPES.USER,
        targetId: providerId,
        targetType: TARGET_TYPES.SSO_PROVIDER,
        ipAddress: auditCtx.ipAddress,
        userAgent: auditCtx.userAgent,
        metadata: { organizationId: tenant.organizationId },
      },
      tx
    );
    return true;
  });
}

export async function rotateSecret(
  db: DrizzleClient,
  env: AppBindings,
  tenant: Tenant,
  providerId: string,
  clientSecret: string,
  actorId: string,
  auditCtx: AuditContext,
  invalidator?: FanOutInvalidator
): Promise<boolean> {
  // Atomic rotation: read the current config via the decrypted view, patch
  // the clientSecret, write the encrypted blob, revoke sessions, and bump
  // the session version — all inside one transaction with `app.sso_key`
  // set so both the SELECT (via `sso_providers_decrypted`) and the UPDATE
  // (via `pgp_sym_encrypt`) can use it. Splitting these into separate
  // transactions would open a window where a concurrent rotation could be
  // overwritten.
  const rotated = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.sso_key = ${env.SSO_KEY}`);

    const result = await tx.execute(
      sql`SELECT oidc_config FROM sso_providers_decrypted WHERE id = ${providerId} AND organization_id = ${tenant.organizationId}`
    );
    type RowShape = { oidc_config: string | null };
    // boundary: vendor-SDK generic variance — drizzle's tx.execute returns a
    // QueryResult-like value whose shape varies across drivers. The SELECT
    // explicitly names oidc_config so the runtime shape is RowShape; we
    // validate the parsed JSON below before reading any field.
    const rows = (result as unknown as { rows?: RowShape[] }).rows ?? [];
    const row = rows[0];
    if (!row) {
      return false;
    }

    let parsedConfig: Record<string, unknown> = {};
    if (row.oidc_config) {
      try {
        // boundary: Zod input parsing — oidc_config is JSON we wrote on
        // create/rotate; defensively guard the shape before merging.
        const parsed = JSON.parse(row.oidc_config) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedConfig = parsed as Record<string, unknown>;
        }
      } catch {
        // Corrupt blob — replace entirely with the new secret + clientId stub.
      }
    }
    const updatedConfig: OidcConfig = {
      // Preserve any non-secret fields like discoveryEndpoint, scopes, etc.
      ...(parsedConfig as Partial<OidcConfig>),
      // Default clientId so the type-required field is always present even
      // if the prior blob was corrupt or missing it.
      clientId:
        typeof parsedConfig.clientId === "string" ? parsedConfig.clientId : "",
      clientSecret,
    };

    const updated = await ssoProviderRepository.rotateEncrypted(
      tx,
      tenant.organizationId,
      providerId,
      updatedConfig
    );
    if (!updated) {
      return false;
    }

    // Revoke all sessions for the org (D34: session version bump)
    await tx
      .delete(schema.sessions)
      .where(eq(schema.sessions.activeOrganizationId, tenant.organizationId));

    // Bump session_version so any cached JWTs fail the verifier check
    await tx
      .update(schema.organizations)
      .set({ sessionVersion: sql`session_version + 1` })
      .where(eq(schema.organizations.id, tenant.organizationId));

    await auditLogService.create(
      {
        event: AUDIT_EVENTS.SSO.SECRET_ROTATED.event,
        actorId,
        actorType: ACTOR_TYPES.USER,
        targetId: providerId,
        targetType: TARGET_TYPES.SSO_PROVIDER,
        ipAddress: auditCtx.ipAddress,
        userAgent: auditCtx.userAgent,
        metadata: { organizationId: tenant.organizationId },
      },
      tx
    );

    return true;
  });

  // A4.5 — after the rotation tx commits, invalidate caches so any worker
  // holding a stale Better-Auth options snapshot or session-version cache
  // reads the new state. `fanOutBumpVersion()` bumps own-colo KV AND fans
  // out to the auth worker via the AUTH.bumpTenantCacheVersion RPC. Best
  // effort: a transient RPC failure must not roll back the persisted
  // rotation row.
  if (rotated && invalidator) {
    try {
      await invalidator.fanOutBumpVersion();
    } catch (error) {
      logger.warn("fanOutBumpVersion after rotateSecret failed", {
        organizationId: tenant.organizationId,
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return rotated;
}
