# Common Mistakes

| Avoid | Prefer |
| --- | --- |
| `guard: isAuthenticated` | `guard: [isAuthenticated]` |
| hard-coded permission strings | shared `PERMISSIONS.*` constants |
| `c.req.valid("params")` | `c.req.valid("param")` |
| implicit status response | `c.json(payload, 200)` |
| empty catch blocks | explicit log + throw/mapped error |
| global `pg.Client` or Drizzle singleton | per-request `c.var.db` from `dbMiddleware` |
| `import { env }` inside a Hono handler | `c.env` inside handlers |
| floating promises (no `await`) | always `await` or register with `waitUntil` |
| mutable module-level state | keep state in DO storage or KV |
| sharing a DB client across Workflow steps | each step creates and closes its own client |
