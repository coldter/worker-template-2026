import type { DrizzleClient } from "@repo/db";
import { firstOrNull, liveOrganizations } from "@repo/db";
import { organizations, tenantCustomHostnames } from "@repo/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
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
    // Optional: when absent, corrupt cache entries remain until TTL expiry.
    delete?(req: Request): Promise<boolean>;
  };
  kv: { get(key: string): Promise<string | null> };
  config: HostConfig;
  waitUntil: (p: Promise<unknown>) => void;
}>;

const POSITIVE_TTL = 60;
const NEGATIVE_TTL = 5;

// Dates round-trip through JSON as ISO strings; accept both and normalise.
const cachedDateSchema = z.union([
  z.date(),
  z
    .string()
    .refine(
      (s) => !Number.isNaN(new Date(s).getTime()),
      "must be a parseable ISO date string"
    )
    .transform((s) => new Date(s)),
]);
const cachedNullableDateSchema = z.union([cachedDateSchema, z.null()]);

const cachedTenantSchema = z.object({
  organizationId: z.string(),
  slug: z.union([z.string(), z.null()]),
  host: z.string(),
  kind: z.union([z.literal("subdomain"), z.literal("custom")]),
  enforceSSO: z.boolean(),
  sessionVersion: z.number(),
  suspendedAt: cachedNullableDateSchema,
  deletedAt: cachedNullableDateSchema,
});

const cachedShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), tenant: cachedTenantSchema }),
  z.object({ kind: z.literal("not_found"), host: z.string() }),
  z.object({ kind: z.literal("suspended"), tenant: cachedTenantSchema }),
]);

type CachedShape = z.infer<typeof cachedShapeSchema>;

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
    // boundary: Cache API returns opaque text; validate against the schema
    // before trusting it (legacy/corrupt rows could otherwise crash callers).
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }
    const result = cachedShapeSchema.safeParse(parsed);
    if (result.success) {
      const cached = result.data;
      return cached.kind === "found" ? cached.tenant : cached;
    }
    // Evict invalid entries so the next request skips the parse-and-fail cost.
    const cacheDelete = deps.cache.delete;
    if (cacheDelete) {
      deps.waitUntil(cacheDelete.call(deps.cache, req));
    }
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "tenancy.cache.invalid_shape",
        host: canonicalHost,
        cacheKey: req.url,
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      })
    );
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
