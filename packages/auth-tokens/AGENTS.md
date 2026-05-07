# @repo/auth-tokens — Package Guide

## Responsibility

Verifier-side helper for per-tenant JWTs. Better Auth (in `apps/auth`) continues to mint tokens; this package only verifies them. Two variants:

- `verifyTenantJwt` — stateful: looks up the current `sessionVersion` from the `organizations` row via the injected Drizzle client.
- `verifyTenantJwtStateless` — caller passes `expectedMinSessionVersion` (used by edge consumers that already have the row in hand).

## JWT invariants (D12 / D53)

All five invariants are enforced by `verifyTenantJwt(Stateless)`. A new claim is a public-API change.

1. JWS signature against the auth worker's JWKS.
2. `aud` equals `https://${expectedHost}` (URL-form).
3. `iss` equals `https://${expectedHost}` (URL-form).
4. `org.host` equals `expectedHost` AND `org.id` equals `expectedOrgId`.
5. `org.sessionVersion >= currentSessionVersion` (DB or caller-provided).

## JWKS endpoint contract

- `createRemoteJwksResolver(url)` wraps jose's `createRemoteJWKSet`. jose memoises the JWKS internally and refreshes when an unknown `kid` shows up, so per-isolate snapshot semantics fall out for free — each Worker isolate that calls this gets its own jose set.
- The JWKS endpoint is served by the auth worker at `/api/auth/jwks` and is the **single tenant-independent path** in the auth surface (`AuthEntrypoint.handleAuthRequest` accepts `tenant === null` only on this path). Verifiers can therefore fetch JWKS without a resolved tenant context.
- Key rotation cadence is owned by Better Auth (default 30 days). Do not pin a `kid` in this package.

## Critical Rules

- Never import from `@repo/auth` or `apps/auth`. This package is read-only relative to BA.
- Public API is exactly `verifyTenantJwt`, `verifyTenantJwtStateless`, `createRemoteJwksResolver`, and the type exports. No new exports without callout.
- Tests cover one failing case per invariant. Adding a new claim is a public-API change.
- No `any`, no `!` non-null assertions, no emojis.
- `unknown` and `as unknown as <T>` only at validated boundaries with `// boundary:` comment (e.g., jose generic resolver shape, Drizzle generics).

## Decisions

- D12 — JWT shape: URL-form `aud`/`iss`, `org` claim with `{ id, host, sessionVersion }`.
- D53 — `verifyTenantJwt` enforces the 5-invariant matrix.
- D70 — verifier-side only; minting stays in BA.
