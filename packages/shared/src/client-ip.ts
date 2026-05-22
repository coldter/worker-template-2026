// Only `CF-Connecting-IP` is trusted on the Cloudflare edge; `X-Forwarded-For` is client-controllable and unsafe for security-sensitive decisions.
export function getClientIpFromHeaders(headers: Headers): string | undefined {
  const header = headers.get("cf-connecting-ip");
  if (!header) {
    return;
  }
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
