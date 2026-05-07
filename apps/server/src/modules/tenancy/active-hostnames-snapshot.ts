/**
 * A5 / D29 — Per-isolate snapshot of active custom hostnames so the
 * host-header guard can admit them at the edge WITHOUT a per-request DB
 * lookup. The snapshot is refreshed from KV under
 * `ACTIVE_CUSTOM_HOSTNAMES_KEY` on a short TTL; the lifecycle service writes
 * the JSON-encoded array on every transition into/out of `active`.
 *
 * Reads are best-effort — if KV is unreachable the guard falls closed (no
 * hostname admitted via this path) which matches the documented edge-only
 * allowlist. The DB-backed `tenancy` middleware then resolves the tenant.
 */

export const ACTIVE_CUSTOM_HOSTNAMES_KEY = "tenancy:active-custom-hostnames";
const SNAPSHOT_TTL_MS = 30_000;

type Snapshot = Readonly<{
  set: ReadonlySet<string>;
  loadedAt: number;
}>;

const cache = new WeakMap<object, Snapshot>();

type SnapshotEnv = Readonly<{
  CACHE: { get(key: string): Promise<string | null> };
}>;

export async function getActiveCustomHostnamesSnapshot(
  env: SnapshotEnv,
  now: () => number = () => Date.now()
): Promise<ReadonlySet<string>> {
  const cached = cache.get(env);
  if (cached && now() - cached.loadedAt < SNAPSHOT_TTL_MS) {
    return cached.set;
  }
  const raw = await env.CACHE.get(ACTIVE_CUSTOM_HOSTNAMES_KEY);
  let parsed: ReadonlySet<string>;
  if (raw) {
    try {
      // boundary: KV stores opaque text; we parse JSON we wrote ourselves.
      const json = JSON.parse(raw) as unknown;
      if (
        Array.isArray(json) &&
        json.every((x): x is string => typeof x === "string")
      ) {
        parsed = new Set(json);
      } else {
        parsed = new Set();
      }
    } catch {
      parsed = new Set();
    }
  } else {
    parsed = new Set();
  }
  cache.set(env, { set: parsed, loadedAt: now() });
  return parsed;
}

/**
 * Test/seam helper — clear the per-isolate snapshot for a given env so the
 * next read forces a KV refresh.
 */
export function _resetSnapshotCacheForTests(env: object): void {
  cache.delete(env);
}

type WriteTarget = { put(key: string, value: string): Promise<void> };

export async function writeActiveCustomHostnamesSnapshot(
  cache: WriteTarget,
  hostnames: readonly string[]
): Promise<void> {
  await cache.put(ACTIVE_CUSTOM_HOSTNAMES_KEY, JSON.stringify(hostnames));
}
