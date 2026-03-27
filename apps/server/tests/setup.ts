import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Context, Next } from "hono";
import { Client } from "pg";
import { vi } from "vitest";
import { relations } from "@/db/relations";
import * as schema from "@/db/schema";
import { accounts, sessions, users, verifications } from "@/db/schema/auth";
import { logger } from "@/lib/logger";

const client = new Client({
  connectionString: process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL,
});
await client.connect();
const db = drizzle({ client, schema, relations, casing: "snake_case" });

vi.mock("@/middlewares/rate-limit", () => ({
  rateLimiter: vi.fn().mockReturnValue(async (_: Context, next: Next) => {
    await next();
  }),
  globalRateLimitMW: async (_: Context, next: Next) => {
    await next();
  },
}));

export function mockFetchRequest() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: string | Request | URL) => {
      if (input instanceof Request) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            try {
              return await input.clone().json();
            } catch {
              return {};
            }
          },
          text: async () => "",
          clone: () => input.clone(),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
        clone: () => ({
          json: async () => ({}),
          text: async () => "",
        }),
      });
    })
  );
}

export async function clearDatabase() {
  await db.delete(sessions);
  await db.delete(verifications);
  await db.delete(accounts);
  await db.delete(users);
}

export async function migrateDatabase() {
  const migrationsPath = path.resolve(
    import.meta.dirname,
    "../src/db/migrations"
  );
  logger.info(`[Test Setup] Running migrations from ${migrationsPath}`);

  try {
    await migrate(db, { migrationsFolder: migrationsPath });
    logger.info("[Test Setup] Migrations completed successfully");
  } catch (error) {
    logger.error("[Test Setup] Migrations failed:", { error });
    throw error;
  }
}
