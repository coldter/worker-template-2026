const STRIP_PORT_RE = /:\d+$/;
const STRIP_TRAILING_DOT_RE = /\.$/;

/**
 * Normalize a raw `Host` header for equality comparison against configured
 * hosts (e.g. `ADMIN_HOST`, `FALLBACK_HOST`). Strips port and trailing dot,
 * applies NFC normalization, and lowercases. Returns the empty string when
 * the input is empty.
 *
 * Mirrors the front of `parseHostname()` but without the punycode / structure
 * checks — callers that only need to compare against a known constant should
 * use this helper.
 */
export function normalizeHostHeader(rawHost: string): string {
  if (!rawHost) {
    return "";
  }
  return rawHost
    .replace(STRIP_PORT_RE, "")
    .replace(STRIP_TRAILING_DOT_RE, "")
    .normalize("NFC")
    .toLowerCase();
}
