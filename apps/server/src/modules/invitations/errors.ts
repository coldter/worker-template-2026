/**
 * D60 — Better Auth's `createUser` is non-idempotent: re-creating the same
 * email produces a thrown error, not a return value. The accept handler must
 * catch that specific case and recover by looking up the existing user. BA
 * doesn't export the error class, so we narrow on `code` and message at the
 * boundary.
 */
const ALREADY_EXISTS_RE = /already exists/i;

export function isUserAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  // boundary: BA RPC error shape narrowed at validated boundary.
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code === "USER_ALREADY_EXISTS") {
    return true;
  }
  if (typeof e.message === "string" && ALREADY_EXISTS_RE.test(e.message)) {
    return true;
  }
  return false;
}
