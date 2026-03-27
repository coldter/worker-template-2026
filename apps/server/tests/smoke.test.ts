import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";

const canRun = !!(process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL);

describe.skipIf(!canRun)("Smoke Test", () => {
  it("should respond to health check (ping)", async () => {
    const { default: app } = await import("@/server");
    const client = testClient(app);

    // @ts-expect-error - ping is on baseApp but types might be tricky with .route()
    const res = await client.ping.$get();

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("message");
    expect(data.message).toContain("pong");
  });
});
