import path from "node:path";

import { createDrizzleClient } from "@repo/db/client";
import { accounts, sessions, users, verifications } from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { vi } from "vitest";

const client = new Client({
  connectionString: process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL,
});

await client.connect();

const db = createDrizzleClient(
  client,
  process.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined
);

export const mockFetchRequest = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: string | Request | URL) => {
      if (input instanceof Request) {
        return Promise.resolve({
          clone: () => input.clone(),
          json: async () => {
            try {
              return await input.clone().json();
            } catch {
              return {};
            }
          },
          ok: true,
          status: 200,
          text: () => "",
        });
      }

      return Promise.resolve({
        clone: () => ({
          json: () => ({}),
          text: () => "",
        }),
        json: () => ({}),
        ok: true,
        status: 200,
        text: () => "",
      });
    })
  );
};

export const clearDatabase = async () => {
  await db.delete(sessions);
  await db.delete(verifications);
  await db.delete(accounts);
  await db.delete(users);
};

export const migrateDatabase = async () => {
  const migrationsPath = path.resolve(
    import.meta.dirname,
    "../../../packages/db/src/migrations"
  );

  logger.info(`[Test Setup] Running migrations from ${migrationsPath}`);

  try {
    await migrate(db, { migrationsFolder: migrationsPath });
    logger.info("[Test Setup] Migrations completed successfully");
  } catch (error) {
    logger.error("[Test Setup] Migrations failed:", { error });
    throw error;
  }
};
