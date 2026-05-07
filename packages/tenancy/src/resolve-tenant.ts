import type { DrizzleClient } from "@repo/db";
import { firstOrNull, liveOrganizations } from "@repo/db";
import { organizations, tenantCustomHostnames } from "@repo/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { KV_VERSION_KEY, tenantCacheRequest } from "./cache-key";
import type { HostConfig } from "./host-config";
import { parseHostname } from "./parse-hostname";
import type {
  Tenant,
  TenantNotFound,
  TenantResolution,
  TenantSuspended,
} from "./types";

export type ResolveDeps = Readonly<{
  db: DrizzleClient;
  cache: {
    match(req: Request): Promise<Response | undefined>;
    put(req: Request, res: Response): Promise<void>;
  };
  kv: { get(key: string): Promise<string | null> };
  config: HostConfig;
  waitUntil: (p: Promise<unknown>) => void;
}>;

const POSITIVE_TTL = 60;
const NEGATIVE_TTL = 5;

type CachedShape =
  | { kind: "found"; tenant: Tenant }
  | { kind: "not_found"; host: string }
  | { kind: "suspended"; tenant: Tenant };

export async function resolveTenant(
  rawHost: string,
  deps: ResolveDeps
): Promise<TenantResolution> {
  const parsed = parseHostname(rawHost, deps.config);
  if (
    parsed.kind === "rejected" ||
    parsed.kind === "admin" ||
    parsed.kind === "fallback"
  ) {
    return { kind: "not_found", host: rawHost };
  }
  const canonicalHost =
    parsed.kind === "subdomain"
      ? `${parsed.slug}${deps.config.wildcardSuffix}`
      : parsed.host;
  const version = (await deps.kv.get(KV_VERSION_KEY)) ?? "v0";
  const req = tenantCacheRequest(version, canonicalHost);
  const hit = await deps.cache.match(req);
  if (hit) {
    const text = await hit.text();
    // boundary: Cache API stores opaque text; we parse JSON we wrote ourselves.
    const cached = JSON.parse(text) as CachedShape;
    return cached.kind === "found" ? cached.tenant : cached;
  }
  let found: Awaited<ReturnType<typeof lookupBySlug>>;
  if (parsed.kind === "subdomain") {
    found = await lookupBySlug(deps.db, parsed.slug);
  } else {
    found = await lookupByCustomHost(deps.db, canonicalHost);
  }
  if (!found) {
    const result: TenantNotFound = { kind: "not_found", host: canonicalHost };
    deps.waitUntil(
      writeCache(
        deps.cache,
        req,
        { kind: "not_found", host: canonicalHost },
        NEGATIVE_TTL
      )
    );
    return result;
  }
  const tenant: Tenant = {
    organizationId: found.organizationId,
    slug: parsed.kind === "subdomain" ? parsed.slug : null,
    host: canonicalHost,
    kind: parsed.kind,
    enforceSSO: found.enforceSSO,
    sessionVersion: found.sessionVersion,
    suspendedAt: found.suspendedAt,
    deletedAt: found.deletedAt,
  };
  if (tenant.suspendedAt !== null) {
    const suspended: TenantSuspended = { kind: "suspended", tenant };
    deps.waitUntil(writeCache(deps.cache, req, suspended, POSITIVE_TTL));
    return suspended;
  }
  deps.waitUntil(
    writeCache(deps.cache, req, { kind: "found", tenant }, POSITIVE_TTL)
  );
  return tenant;
}

async function writeCache(
  cache: ResolveDeps["cache"],
  req: Request,
  payload: CachedShape,
  ttl: number
): Promise<void> {
  await cache.put(
    req,
    new Response(JSON.stringify(payload), {
      headers: {
        "cache-control": `max-age=${ttl}`,
        "content-type": "application/json",
      },
    })
  );
}

async function lookupBySlug(db: DrizzleClient, slug: string) {
  // `liveOrganizations` already ANDs `organizations.deleted_at IS NULL`.
  return firstOrNull(
    liveOrganizations(db).selectBySlug(
      {
        organizationId: organizations.id,
        enforceSSO: organizations.enforceSSO,
        sessionVersion: organizations.sessionVersion,
        suspendedAt: organizations.suspendedAt,
        deletedAt: organizations.deletedAt,
      },
      slug
    )
  );
}

async function lookupByCustomHost(db: DrizzleClient, host: string) {
  // Custom-host lookups join through tenant_custom_hostnames; the relational
  // query API does not surface this projection, so we hand-write the
  // builder here. The `isNull(organizations.deletedAt)` predicate is
  // explicit (matches what `liveOrganizations` would inject) and is
  // enforced by the structural test in
  // `packages/db/__tests__/live-organizations.spec.ts` allowlist.
  return firstOrNull(
    db
      .select({
        organizationId: organizations.id,
        enforceSSO: organizations.enforceSSO,
        sessionVersion: organizations.sessionVersion,
        suspendedAt: organizations.suspendedAt,
        deletedAt: organizations.deletedAt,
      })
      .from(tenantCustomHostnames)
      .innerJoin(
        organizations,
        eq(tenantCustomHostnames.organizationId, organizations.id)
      )
      .where(
        and(
          eq(tenantCustomHostnames.hostname, host),
          eq(tenantCustomHostnames.lifecycleStatus, "active"),
          isNull(organizations.deletedAt)
        )
      )
  );
}
