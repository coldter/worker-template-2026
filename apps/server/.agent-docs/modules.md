# Module Patterns

Use this layout for `src/modules/<name>`:

```text
<module>/
├── schema.ts     # zod-openapi request/response contracts
├── routes.ts     # route configs + guards + response schemas
├── handler.ts    # OpenAPIHono handlers
└── service.ts    # business logic + data access
```

Optional files: `types.ts`, `constants.ts`, `helpers.ts`, `workflow.ts`.

## Service Signature Convention

Service functions accept `db: DrizzleClient` (or `executor: Executor`) as their first parameter. They never import a global db singleton.

```typescript
// service.ts
export async function createUser(db: DrizzleClient, data: NewUser): Promise<User> { ... }

// handler.ts
const user = await createUser(c.var.db, validated);
```

## Checklist
- Reuse shared schemas/helpers from `@repo/shared` where possible.
- Keep route guards and permission declarations in `routes.ts`.
- Keep authorization ownership checks close to data access in services.
- Register module handler in `src/server.ts` (or `src/routers/main.ts` if it exists).
