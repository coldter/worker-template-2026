# Web App

React SPA with TanStack Router, TanStack Query, Zustand, and Tailwind.

## Critical Rules
- Keep server state in TanStack Query; avoid duplicating it in local stores.
- Use schema-backed forms (React Hook Form + Zod).
- Gate restricted routes and actions with authorization capabilities, but treat them as presentation hints only. The server's `authorize()` checks remain the source of truth.

## Authorization Wiring

- Fetch the capability map from the server and use it for nav, route shells, and broad action visibility.
- Do not assume a capability map is a record-specific allow decision. Ownership, org scope, and relationships still need server checks.
- Keep user-facing denial states clear. "You cannot access this area" and "this particular record cannot be changed" are not the same UX.

See:
- [Authorization package guide](../../packages/authorization/README.md)
- [Authorization quick start](../../packages/authorization/docs/quick-start.md)

## Detailed Instructions
- [Architecture](.agent-docs/architecture.md)
- [Data fetching](.agent-docs/data-fetching.md)
- [State management](.agent-docs/state-management.md)
- [Forms](.agent-docs/forms.md)
- [Permissions](.agent-docs/permissions.md)
- [Tables](.agent-docs/tables.md)
- [UI/UX requirements](.agent-docs/ui-ux.md)
