# Follow-Ups

## Type-Safety Follow-Ups

Captured during the type-safety cleanup. None are blocking; each is an
incremental tightening left for a future pass.

- `packages/authorization/src/schema.ts` + `resource.ts` — fix generic variance
  on the resource/action generics. They currently lose precision when composed;
  pinning them down will remove a couple of residual casts at call sites.
- `apps/server/src/modules/users/handler.ts` — evaluate collapsing the
  handler-local formatter helpers into Zod `.transform()` calls on the response
  schema so the OpenAPI contract and the runtime shape stay in lockstep.
- `apps/auth/src/instance.ts` (inline `override-type` plugin around line 548)
  — retire the custom plugin once Better Auth ships a first-class extension
  point for augmenting the inferred `Session` shape.
- `tsconfig.json` — evaluate `exactOptionalPropertyTypes: true`. The fallout
  is likely medium-sized but will catch a few silent `undefined` vs
  missing-property bugs.
