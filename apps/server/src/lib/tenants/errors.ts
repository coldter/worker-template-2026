/**
 * Typed errors for the operator-led tenant creation flow. The HTTP layer
 * (apps/server entrypoint, apps/admin handler) maps these to 409 responses.
 *
 * `SlugReservedError` — the slug is in `reserved_slugs` (kind = 'slug').
 * `SlugTakenError`   — the slug already exists in `organization` (Postgres
 *                      unique-violation 23505 on `organization_slug_key`).
 */
export class SlugReservedError extends Error {
  // `code` and `slug` are own enumerable properties so they survive Workers
  // RPC serialization across the apps/server <-> apps/admin service binding.
  readonly code = "SLUG_RESERVED";
  readonly slug: string;
  constructor(slug: string) {
    super(`Slug '${slug}' is reserved`);
    this.name = "SlugReservedError";
    this.slug = slug;
  }
}

export class SlugTakenError extends Error {
  readonly code = "SLUG_TAKEN";
  readonly slug: string;
  constructor(slug: string) {
    super(`Slug '${slug}' is already taken`);
    this.name = "SlugTakenError";
    this.slug = slug;
  }
}

/**
 * Typed predicate the HTTP boundary uses to map an RPC-rethrown error from
 * `AdminApiEntrypoint.createTenantOnBehalfOf` to a 409 response. Workers RPC
 * preserves `name`, `message`, and own-enumerable properties (here `code`),
 * but does NOT preserve class identity — `instanceof` cannot be used.
 *
 * boundary: cross-worker RPC error narrowing — properties are validated
 * structurally before use.
 */
export type TenantConflictCode = "SLUG_RESERVED" | "SLUG_TAKEN";

export function tenantConflictCode(err: unknown): TenantConflictCode | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  const e = err as { code?: unknown; name?: unknown };
  if (e.code === "SLUG_RESERVED" || e.name === "SlugReservedError") {
    return "SLUG_RESERVED";
  }
  if (e.code === "SLUG_TAKEN" || e.name === "SlugTakenError") {
    return "SLUG_TAKEN";
  }
  return null;
}

/**
 * Narrow an unknown error to a Postgres unique-violation. `node-postgres`
 * exposes the SQLSTATE on a `code` property; the `constraint` property
 * surfaces the conflicting constraint name when present.
 *
 * boundary: pg driver error shape narrowed at validated boundary — pg does
 * not export an Error subclass we can `instanceof` against from a Worker.
 */
export function isPgUniqueViolation(
  err: unknown,
  constraintName?: string
): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== "23505") {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return typeof e.constraint === "string" && e.constraint === constraintName;
}
