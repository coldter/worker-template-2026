# Server Tests

Vitest tests running in workerd through @cloudflare/vitest-plugin. The setup connects to Postgres, so set DATABASE_TEST_URL and provision the schema first.

```bash
DATABASE_URL=<test-db-url> bun run db:push
bun run test
```

## Commands

```bash
bun run test
bun run test:watch
bun run test:coverage
cd apps/server && bun run test -- -t "pattern"
```

## Structure

```text
tests/
├── setup.ts      # Database client, migrations, and mocks
├── fixtures.ts   # Headers and test data
├── helpers.ts    # Response and assertion helpers
└── **/*.test.ts  # Feature tests
```

Use testClient from hono/testing with the shared fixtures:

```ts
const client = testClient(app);
const res = await client.api.endpoint.$get({}, { headers: defaultHeaders });
```
