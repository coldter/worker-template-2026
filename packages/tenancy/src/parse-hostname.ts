import type { HostConfig } from "./host-config";

export type ParsedHost =
  | { kind: "subdomain"; slug: string }
  | { kind: "custom"; host: string }
  | { kind: "admin" }
  | { kind: "fallback" }
  | { kind: "rejected"; reason: ParseRejectReason };

export type ParseRejectReason =
  | "empty"
  | "invalid_chars"
  | "punycode"
  | "nested_subdomain"
  | "slug_format";

// DNS-label-shaped tenant slug. Single source of truth — also used by the
// dev-header gate so a slug accepted there is exactly a slug accepted here.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Built-in reserved slug list. The DB-backed `reserved_slugs` table covers
 * tombstoned tenant slugs and per-deploy ops choices (D32 / A1c); this list
 * complements it with platform-fixed names that must never be DB-claimable
 * either. Any slug check that runs before a DB lookup (e.g. fast Zod
 * rejection in the admin worker, dev-header gate) should consult this.
 */
export const BUILTIN_RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "auth",
  "api",
  "app",
  "assets",
  "cdn",
  "console",
  "dashboard",
  "docs",
  "internal",
  "login",
  "logout",
  "ops",
  "operator",
  "platform",
  "register",
  "root",
  "signup",
  "static",
  "status",
  "support",
  "system",
  "www",
]);

/**
 * Pure validator for tenant slug shape + built-in reserved list. Does NOT
 * consult the DB-backed `reserved_slugs` table — that lookup is the caller's
 * responsibility (and runs against the same connection as the org insert).
 */
export function isValidSlug(slug: string): boolean {
  if (!SLUG_RE.test(slug)) {
    return false;
  }
  return !BUILTIN_RESERVED_SLUGS.has(slug);
}
const ALLOWED_CHARS_RE = /^[a-z0-9.-]+$/;
const STRIP_PORT_RE = /:\d+$/;
const STRIP_TRAILING_DOT_RE = /\.$/;

export function parseHostname(rawHost: string, config: HostConfig): ParsedHost {
  if (!rawHost) {
    return { kind: "rejected", reason: "empty" };
  }
  const normalized = rawHost
    .replace(STRIP_PORT_RE, "")
    .replace(STRIP_TRAILING_DOT_RE, "")
    .normalize("NFC")
    .toLowerCase();
  if (!normalized) {
    return { kind: "rejected", reason: "empty" };
  }
  if (!ALLOWED_CHARS_RE.test(normalized)) {
    return { kind: "rejected", reason: "invalid_chars" };
  }
  const hasPunycodeLabel = normalized
    .split(".")
    .some((label) => label.startsWith("xn--"));
  if (normalized === config.adminHost) {
    return { kind: "admin" };
  }
  if (normalized === config.fallbackHost) {
    return { kind: "fallback" };
  }
  if (normalized.endsWith(config.wildcardSuffix)) {
    // Punycode under our wildcard suffix is never legal — operator slugs
    // are ASCII-only by policy (matches `SLUG_RE`).
    if (hasPunycodeLabel) {
      return { kind: "rejected", reason: "punycode" };
    }
    const slug = normalized.slice(0, -config.wildcardSuffix.length);
    if (slug.includes(".")) {
      return { kind: "rejected", reason: "nested_subdomain" };
    }
    if (!SLUG_RE.test(slug)) {
      return { kind: "rejected", reason: "slug_format" };
    }
    return { kind: "subdomain", slug };
  }
  // For custom hostnames we DO allow punycode (`xn--*`) labels — tenants
  // can legitimately bring an IDN apex (e.g. `xn--bcher-kva.example`).
  // Subdomain (operator-slug) and admin/fallback paths above already
  // reject punycode where it cannot belong.
  return { kind: "custom", host: normalized };
}
