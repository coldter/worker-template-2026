# Local HTTPS host-accurate harness

Phase 0 documents the contract; Phase A wires the generator and `bun run dev:tls`.

## Why HTTPS locally

Cookie-backed auth, OIDC callbacks, and Better Auth's secure-cookie defaults all require HTTPS. Plain HTTP on `lvh.me` is fine for host-parsing debug, but any test that involves real cookies or SSO callbacks runs against this harness.

## Tooling

- `mkcert` for the wildcard cert (one-time install).
- Caddy v2 as the local TLS terminator and reverse proxy.

## Bootstrap

```bash
mkcert -install
mkdir -p tools/local-tls/certs
cd tools/local-tls
mkcert -cert-file certs/wildcard.pem -key-file certs/wildcard-key.pem \
  "${LOCAL_APP_WILDCARD_HOST}" "*.${LOCAL_APP_WILDCARD_HOST}" \
  "${LOCAL_ADMIN_HOST}" "${LOCAL_FALLBACK_HOST}" \
  "${DEFAULT_DEV_CUSTOM_HOST}"
```

## Run

The Caddyfile.template above reads:

- `LOCAL_APP_WILDCARD_HOST` (e.g. `app.lvh.me`)
- `LOCAL_ADMIN_HOST` (e.g. `admin.lvh.me`)
- `LOCAL_FALLBACK_HOST` (e.g. `fallback.lvh.me`)
- `LOCAL_TLS_PORT` (e.g. `8443`)
- `DEFAULT_DEV_CUSTOM_HOST` (e.g. `app.acme.local.test`, requires `/etc/hosts` entry to 127.0.0.1)

Phase A's generator renders `Caddyfile` from this template plus the root `.env`, and `bun run dev:tls` runs `caddy run --config tools/local-tls/Caddyfile`.

## Contract for Phase A

- `lvh.me` and its subdomains resolve to 127.0.0.1 publicly, so no /etc/hosts edits are required for the wildcard hosts.
- `DEFAULT_DEV_CUSTOM_HOST` simulates a tenant-owned domain. The seed script adds an active `tenant_custom_hostnames` row pointing the dev org at it. Developers add a single `/etc/hosts` line.
- The `apps/server` and `apps/auth` wrangler dev ports remain `8787` and `8788` so service bindings work unchanged.
- `apps/admin` (Phase B) lands on dev port `8789`. The Caddyfile already routes `LOCAL_ADMIN_HOST` to that port to keep the contract stable.
