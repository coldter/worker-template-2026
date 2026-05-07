import type { DrizzleClient, Transaction } from "@repo/db";
import * as schema from "@repo/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * SSO Provider Repository (D56 — deeper module).
 *
 * Centralises all data access for `sso_providers`. The defining property is
 * that plaintext SSO secrets never escape this module:
 *
 * - `findByOrg` / `findById` project an explicit allow-list of public columns
 *   so neither `oidcConfigEncrypted` nor any plaintext `oidc_config` blob is
 *   ever returned to the caller.
 * - `withDecryptedSecret(providerId, fn)` is the only path to plaintext. It
 *   opens a transaction, sets `app.sso_key` with `SET LOCAL`, reads the
 *   decrypted blob from the `sso_providers_decrypted` view (D73 — the view
 *   continues to back BA's raw plugin reads), and yields the parsed
 *   `oidcConfig` object to the caller's closure. The plaintext is bounded by
 *   the closure scope and never persisted on a returned object.
 * - `create` and `rotateEncrypted` write `oidc_config_encrypted` via
 *   `pgp_sym_encrypt` inside a transaction with `SET LOCAL app.sso_key`.
 *
 * Repository methods accept the `Executor` (`DrizzleClient` or `Transaction`)
 * so callers can compose them inside their own transactions when needed
 * (e.g. the rotation flow that also revokes sessions and bumps
 * `session_version`). All queries are tenant-scoped: methods that mutate or
 * read a single provider take an `organizationId` and gate on it in the
 * WHERE clause to prevent cross-tenant access.
 */

export type SsoProviderPublic = {
  id: string;
  organizationId: string;
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type OidcConfig = {
  clientId: string;
  clientSecret: string;
  discoveryEndpoint?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksEndpoint?: string;
  userInfoEndpoint?: string;
  scopes?: string[];
};

export type CreateInput = {
  issuer: string;
  domain: string;
  providerId: string;
  organizationId: string;
  oidcConfig: OidcConfig;
  userId: string;
};

export type UpdateMetadataPatch = {
  issuer?: string;
  domain?: string;
};

const PUBLIC_COLUMNS = {
  id: schema.ssoProviders.id,
  issuer: schema.ssoProviders.issuer,
  domain: schema.ssoProviders.domain,
  providerId: schema.ssoProviders.providerId,
  organizationId: schema.ssoProviders.organizationId,
  domainVerified: schema.ssoProviders.domainVerified,
  createdAt: schema.ssoProviders.createdAt,
  updatedAt: schema.ssoProviders.updatedAt,
} as const;

type Executor = DrizzleClient | Transaction;

function nonNullOrgRow<T extends { organizationId: string | null }>(
  row: T
): (T & { organizationId: string }) | null {
  if (!row.organizationId) {
    return null;
  }
  return { ...row, organizationId: row.organizationId };
}

async function findByOrg(
  db: Executor,
  organizationId: string
): Promise<SsoProviderPublic[]> {
  const rows = await db
    .select(PUBLIC_COLUMNS)
    .from(schema.ssoProviders)
    .where(eq(schema.ssoProviders.organizationId, organizationId));
  return rows
    .map(nonNullOrgRow)
    .filter((row): row is SsoProviderPublic => row !== null);
}

async function findById(
  db: Executor,
  organizationId: string,
  providerRowId: string
): Promise<SsoProviderPublic | null> {
  const rows = await db
    .select(PUBLIC_COLUMNS)
    .from(schema.ssoProviders)
    .where(
      and(
        eq(schema.ssoProviders.id, providerRowId),
        eq(schema.ssoProviders.organizationId, organizationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return nonNullOrgRow(row);
}

/**
 * Insert a new SSO provider with encrypted oidc config.
 *
 * The caller must open a transaction and `SET LOCAL app.sso_key = <key>` on
 * that transaction before calling. This keeps the secrets-key plumbing
 * explicit at the call site and aligns with the rotation flow which also
 * needs to set the session key once for the whole transaction.
 */
async function create(
  tx: Transaction,
  input: CreateInput
): Promise<SsoProviderPublic> {
  const [provider] = await tx
    .insert(schema.ssoProviders)
    .values({
      issuer: input.issuer,
      domain: input.domain,
      providerId: input.providerId,
      organizationId: input.organizationId,
      oidcConfigEncrypted: sql`pgp_sym_encrypt(${JSON.stringify(input.oidcConfig)}, current_setting('app.sso_key'))`,
      userId: input.userId,
      domainVerified: false,
    })
    .returning(PUBLIC_COLUMNS);
  if (!provider) {
    throw new Error("Failed to create SSO provider");
  }
  const result = nonNullOrgRow(provider);
  if (!result) {
    throw new Error(
      "SSO provider organizationId unexpectedly null after insert"
    );
  }
  return result;
}

/**
 * Update non-secret metadata (issuer, domain). Returns the updated row, or
 * null when no row matches the (orgId, providerRowId) pair.
 */
async function updateMetadata(
  db: Executor,
  organizationId: string,
  providerRowId: string,
  patch: UpdateMetadataPatch
): Promise<SsoProviderPublic | null> {
  const updateValues: Partial<{
    issuer: string;
    domain: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (patch.issuer !== undefined) {
    updateValues.issuer = patch.issuer;
  }
  if (patch.domain !== undefined) {
    updateValues.domain = patch.domain;
  }
  const [updated] = await db
    .update(schema.ssoProviders)
    .set(updateValues)
    .where(
      and(
        eq(schema.ssoProviders.id, providerRowId),
        eq(schema.ssoProviders.organizationId, organizationId)
      )
    )
    .returning(PUBLIC_COLUMNS);
  if (!updated) {
    return null;
  }
  return nonNullOrgRow(updated);
}

/**
 * Hard-delete an SSO provider scoped to its organization. Returns true when
 * a row was deleted, false when none matched.
 */
async function remove(
  db: Executor,
  organizationId: string,
  providerRowId: string
): Promise<boolean> {
  const [deleted] = await db
    .delete(schema.ssoProviders)
    .where(
      and(
        eq(schema.ssoProviders.id, providerRowId),
        eq(schema.ssoProviders.organizationId, organizationId)
      )
    )
    .returning({ id: schema.ssoProviders.id });
  return Boolean(deleted);
}

/**
 * Replace the encrypted oidc config blob in-place. Caller MUST have set
 * `app.sso_key` on the transaction before calling. Clears the legacy
 * plaintext `oidc_config` column to prevent stale plaintext leakage. Returns
 * true when a row was updated, false when none matched.
 */
async function rotateEncrypted(
  tx: Transaction,
  organizationId: string,
  providerRowId: string,
  newOidcConfig: OidcConfig
): Promise<boolean> {
  const [updated] = await tx
    .update(schema.ssoProviders)
    .set({
      oidcConfigEncrypted: sql`pgp_sym_encrypt(${JSON.stringify(newOidcConfig)}, current_setting('app.sso_key'))`,
      oidcConfig: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.ssoProviders.id, providerRowId),
        eq(schema.ssoProviders.organizationId, organizationId)
      )
    )
    .returning({ id: schema.ssoProviders.id });
  return Boolean(updated);
}

type DecryptedRow = { oidc_config: string | null };

/**
 * Run `fn` inside a fresh transaction with `app.sso_key` set, yielding the
 * decrypted oidc config from `sso_providers_decrypted`. The plaintext is
 * scoped to the closure: it is never returned by this method, never persisted
 * on the result object, and (combined with the logger redactor) never
 * surfaces in structured log output.
 *
 * Lookups are scoped by both `organizationId` and `providerRowId` to prevent
 * cross-tenant secret access. Throws when no row matches or when the
 * decrypted blob cannot be parsed.
 */
async function withDecryptedSecret<T>(
  db: DrizzleClient,
  ssoKey: string,
  organizationId: string,
  providerRowId: string,
  fn: (oidcConfig: OidcConfig) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.sso_key = ${ssoKey}`);
    const result = await tx.execute(
      sql`SELECT oidc_config FROM sso_providers_decrypted WHERE id = ${providerRowId} AND organization_id = ${organizationId}`
    );
    // boundary: vendor-SDK generic variance — drizzle's tx.execute returns a
    // QueryResult-like value whose shape varies across drivers. We narrow
    // through `unknown` to the shape we know the SELECT produces, then
    // validate at runtime below before reading any field.
    const rows = (result as unknown as { rows?: DecryptedRow[] }).rows ?? [];
    const row = rows[0];
    if (!row?.oidc_config) {
      throw new Error(
        `SSO provider ${providerRowId} not found or missing oidc_config`
      );
    }
    // boundary: Zod input parsing — `oidc_config` is JSON text from a
    // controlled column we wrote during create/rotate. Validate the parsed
    // value is a plain object with the required fields before yielding.
    const parsed = JSON.parse(row.oidc_config) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).clientId !== "string" ||
      typeof (parsed as Record<string, unknown>).clientSecret !== "string"
    ) {
      throw new Error(
        `SSO provider ${providerRowId} oidc_config is missing clientId/clientSecret`
      );
    }
    const oidcConfig = parsed as OidcConfig;
    return fn(oidcConfig);
  });
}

export const ssoProviderRepository = {
  findByOrg,
  findById,
  create,
  updateMetadata,
  remove,
  rotateEncrypted,
  withDecryptedSecret,
};

export type SsoProviderRepository = typeof ssoProviderRepository;
