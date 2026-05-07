import {
  CfApiContractError,
  type CfCustomHostname,
  cfApiEnvelopeSchema,
  cfCustomHostnameSchema,
} from "./cf-api.types";

/**
 * Cloudflare-for-SaaS API wrapper (D5, D7).
 *
 * DCV decision (Wave 2):
 *   We use `ssl.method: "txt"` instead of `"http"`. HTTP DCV would require
 *   the server worker to serve a per-hostname challenge under
 *   `/.well-known/pki-validation/...`, which adds a routing surface and
 *   tight coupling to a specific path. TXT DCV keeps the validation
 *   responsibility on the tenant's DNS (where they already added our
 *   `_app-verify` TXT to prove control). Tenants will need to add TWO TXT
 *   records (the existing pre-validation TXT plus the CF-issued
 *   `_acme-challenge` TXT). The CF response surfaces the records on
 *   `ssl.validation_records[].txt_name` / `txt_value` which we round-trip
 *   to the tenant via the `preValidation` payload.
 *
 * Per Phase 0 lock, the request body for `createCustomHostname` OMITS:
 * - `certificate_authority` (Enterprise-only; setting `"google"` returns
 *   error 1459 on Pro/Business — let CF auto-select).
 * - `custom_metadata` (Enterprise paid add-on; the resolver uses the DB path).
 *
 * The wrapper accepts a small env shape so it can be tested without the
 * full `CloudflareBindings`.
 */
export type CfApiEnv = Readonly<{
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
}>;

export type SleepFn = (ms: number) => Promise<void>;

export type CfApiDeps = Readonly<{
  fetch?: typeof globalThis.fetch;
  sleep?: SleepFn;
  /**
   * Optional source of pseudo-random jitter (0..1). Tests inject a
   * deterministic stub; production uses `Math.random`.
   */
  random?: () => number;
  now?: () => number;
}>;

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const RETRY_BASE_MS = 250;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_TOTAL_BUDGET_MS = 30_000;
// Cap each backoff slot so a single Retry-After value cannot pin us above the
// total per-request budget.
const RETRY_PER_SLEEP_CAP_MS = 10_000;

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const DELTA_SECONDS_RE = /^\d+$/;

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Parse a `Retry-After` header value. The header may carry either an
 * integer number of seconds or an HTTP-date. Returns `null` if the value
 * is missing or unparseable so the caller can fall back to exponential
 * backoff.
 */
export function parseRetryAfterMs(
  header: string | null,
  now: number = Date.now()
): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }
  // delta-seconds form (RFC 9110 §10.2.3).
  if (DELTA_SECONDS_RE.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return seconds * 1000;
  }
  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return Math.max(0, dateMs - now);
}

type RetryDecision<T> =
  | { retry: false; value: T }
  | { retry: true; retryAfterMs?: number };

async function withRetries<T>(
  fn: () => Promise<RetryDecision<T>>,
  deps: CfApiDeps
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const start = now();
  let attempt = 0;
  // First attempt + up to RETRY_MAX_ATTEMPTS retries.
  while (true) {
    const decision = await fn();
    if (!decision.retry) {
      return decision.value;
    }
    if (attempt >= RETRY_MAX_ATTEMPTS) {
      throw new CfApiContractError(
        "CF API retry budget exhausted",
        undefined,
        429
      );
    }
    const elapsed = now() - start;
    if (elapsed >= RETRY_TOTAL_BUDGET_MS) {
      throw new CfApiContractError(
        "CF API per-request time budget exhausted",
        undefined,
        429
      );
    }
    const backoff = Math.min(
      RETRY_PER_SLEEP_CAP_MS,
      decision.retryAfterMs ?? RETRY_BASE_MS * 2 ** attempt
    );
    // Add up to 25% jitter so concurrent callers don't sync.
    const jitter = Math.floor(backoff * 0.25 * random());
    const remaining = Math.max(0, RETRY_TOTAL_BUDGET_MS - elapsed);
    const waitMs = Math.min(remaining, backoff + jitter);
    await sleep(waitMs);
    attempt += 1;
  }
}

async function parseEnvelope(res: Response): Promise<unknown> {
  const text = await res.text();
  let json: unknown;
  try {
    // boundary: HTTP response body — Zod-validated immediately below.
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new CfApiContractError("CF response was not JSON", cause);
  }
  const parsed = cfApiEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new CfApiContractError(
      "CF response did not match envelope schema",
      parsed.error
    );
  }
  if (!parsed.data.success) {
    const first = parsed.data.errors?.[0];
    throw new CfApiContractError(
      first?.message ?? "CF API call failed",
      parsed.data.errors,
      first?.code
    );
  }
  return parsed.data.result;
}

function readRetryAfter(res: Response, now: () => number): number | null {
  const header = res.headers.get("retry-after");
  return parseRetryAfterMs(header, now());
}

export async function createCustomHostname(
  env: CfApiEnv,
  hostname: string,
  deps: CfApiDeps = {}
): Promise<CfCustomHostname> {
  const url = `${DEFAULT_BASE_URL}/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames`;
  const body = JSON.stringify({
    hostname,
    ssl: {
      method: "txt",
      type: "dv",
      settings: { min_tls_version: "1.2" },
    },
  });
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  const result = await withRetries<unknown>(async () => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: authHeaders(env.CLOUDFLARE_API_TOKEN),
      body,
    });
    if (res.status === 429) {
      // Drain body so the connection can be reused.
      await res.text().catch(() => undefined);
      const retryAfterMs = readRetryAfter(res, now);
      return retryAfterMs === null
        ? { retry: true }
        : { retry: true, retryAfterMs };
    }
    return { retry: false, value: await parseEnvelope(res) };
  }, deps);

  // boundary: CF API response — Zod-validated.
  const parsed = cfCustomHostnameSchema.safeParse(result);
  if (!parsed.success) {
    throw new CfApiContractError(
      "CF createCustomHostname response missing fields",
      parsed.error
    );
  }
  return parsed.data;
}

/**
 * Returns null when the row was deleted upstream (CF 404 — the 7-day backoff
 * tombstone). Throws on any other non-success.
 */
export async function getCustomHostname(
  env: CfApiEnv,
  cfHostnameId: string,
  deps: CfApiDeps = {}
): Promise<CfCustomHostname | null> {
  const url = `${DEFAULT_BASE_URL}/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${cfHostnameId}`;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  const result = await withRetries<unknown | { __not_found: true } | null>(
    async () => {
      const res = await fetchFn(url, {
        method: "GET",
        headers: authHeaders(env.CLOUDFLARE_API_TOKEN),
      });
      if (res.status === 404) {
        await res.text().catch(() => undefined);
        return { retry: false, value: { __not_found: true } };
      }
      if (res.status === 429) {
        await res.text().catch(() => undefined);
        const retryAfterMs = readRetryAfter(res, now);
        return retryAfterMs === null
          ? { retry: true }
          : { retry: true, retryAfterMs };
      }
      return { retry: false, value: await parseEnvelope(res) };
    },
    deps
  );

  if (
    result !== null &&
    typeof result === "object" &&
    "__not_found" in result
  ) {
    return null;
  }
  // boundary: CF API response — Zod-validated.
  const parsed = cfCustomHostnameSchema.safeParse(result);
  if (!parsed.success) {
    throw new CfApiContractError(
      "CF getCustomHostname response missing fields",
      parsed.error
    );
  }
  return parsed.data;
}

/**
 * Returns true when the delete succeeded OR when CF returned 404 (already
 * gone — idempotent). Throws on any other non-success.
 */
export async function deleteCustomHostname(
  env: CfApiEnv,
  cfHostnameId: string,
  deps: CfApiDeps = {}
): Promise<boolean> {
  const url = `${DEFAULT_BASE_URL}/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${cfHostnameId}`;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  return withRetries<boolean>(async () => {
    const res = await fetchFn(url, {
      method: "DELETE",
      headers: authHeaders(env.CLOUDFLARE_API_TOKEN),
    });
    if (res.status === 404) {
      await res.text().catch(() => undefined);
      return { retry: false, value: true };
    }
    if (res.status === 429) {
      await res.text().catch(() => undefined);
      const retryAfterMs = readRetryAfter(res, now);
      return retryAfterMs === null
        ? { retry: true }
        : { retry: true, retryAfterMs };
    }
    await parseEnvelope(res);
    return { retry: false, value: true };
  }, deps);
}
