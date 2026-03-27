# Background Jobs (Cloudflare Workflows)

Workflows handle async multi-step tasks with built-in retries and durable execution.

## Structure

Each workflow is a class extending `WorkflowEntrypoint<CloudflareBindings, Params>` in `src/workflows/<name>.ts`.

```typescript
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export class MyWorkflow extends WorkflowEntrypoint<CloudflareBindings, MyParams> {
  async run(event: WorkflowEvent<MyParams>, step: WorkflowStep): Promise<void> {
    await step.do("step-name", { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } }, async () => {
      // Each step creates its own DB connection
      const client = new Client({ connectionString: this.env.HYPERDRIVE.connectionString });
      await client.connect();
      const db = drizzle({ client, schema, relations, casing: "snake_case" });
      // ... do work ...
      await client.end();
    });
  }
}
```

## Rules
- Export the class from `src/index.ts` so Wrangler can bind it.
- Add a `[[workflows]]` entry in `wrangler.jsonc` for each workflow.
- Each step creates and closes its own `pg.Client`; do not share connections across steps.
- Do not make the originating HTTP request depend on workflow completion; trigger and return immediately.
- Trigger a workflow via its binding: `await c.env.MY_WORKFLOW.create({ params: { ... } })`.
