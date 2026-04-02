# Permissions Module

Authorization gating for routes, UI visibility, and action-level controls.

## Essentials
- Use `useAuthorization()` from `@/hooks/use-authorization` for capability checks.
- Use `<Authorized capability="resource:action">` for conditional rendering.
- Capabilities are fetched from `GET /api/authorization/capabilities` and cached via TanStack Query.
- These are presentation hints only -- the server enforces real authorization.
