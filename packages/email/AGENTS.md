# Email Package (`@repo/email`)

React Email templates plus a Resend transport wrapper. Consumed by `apps/server` and `apps/auth` for transactional sends.

## Public surface

- `sendEmail({ apiKey, from, to, subject, template, props })` — returns `{ success: true }` or `{ success: false, error }`. Always handle both branches.
- React Email templates exported from `@repo/email` (welcome, security alerts, invitation, etc.).

## Rules

- Pass `apiKey` (the `RESEND_API_KEY` secret) directly. Do not instantiate `Resend` yourself.
- Templates are pure React components — no IO, no side effects, no `process.env` reads.
- Brand strings come from `@repo/shared/brand`. Do not hard-code "App" / "Acme Inc." in templates.

## Details
- [Template rules](.agent-docs/rules.md)
- [Package structure](.agent-docs/structure.md)
- [Configuration and usage](.agent-docs/usage.md)
