# Common Mistakes

| Avoid | Prefer |
| --- | --- |
| custom guard wiring outside `createRouteConfig` | define guards via the `guard` field in route config |
| old `requirePermission()` / `isAuthenticated` guards | `authorize("resource", "action")` from `@/auth/middleware` |
| `c.req.valid("params")` | `c.req.valid("param")` |
| implicit status response | `c.json(payload, 200)` |
| empty catch blocks | explicit log + throw/mapped error |
| global `pg.Client` or Drizzle singleton | per-request `c.var.db` from `dbMiddleware` |
| `import { env }` inside a Hono handler | `c.env` inside handlers |
| floating promises (no `await`) | always `await` or register with `waitUntil` |
| mutable module-level state | keep state in DO storage or KV |
| sharing a DB client across Workflow steps | each step creates and closes its own client |
