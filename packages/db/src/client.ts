import type { Logger as DrizzleLoggerInterface } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { relations } from "./relations";

export function createDrizzleClient(
  client: Client,
  logger?: DrizzleLoggerInterface
) {
  return drizzle({
    client,
    relations,
    ...(logger && { logger }),
  });
}

export type WithDrizzleClientOptions = {
  logger?: DrizzleLoggerInterface;
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * Create a temporary Postgres connection, build a Drizzle client, run the
 * callback, and guarantee cleanup. If `waitUntil` is provided the client end
 * is handed off fire-and-forget; otherwise it is awaited synchronously.
 */
export async function withDrizzleClient<T>(
  connectionString: string,
  callback: (db: DrizzleClient) => Promise<T>,
  options?: WithDrizzleClientOptions
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  const db = createDrizzleClient(client, options?.logger);
  try {
    return await callback(db);
  } finally {
    const endPromise = client.end();
    if (options?.waitUntil) {
      options.waitUntil(endPromise);
    } else {
      await endPromise;
    }
  }
}

function _inferType() {
  return createDrizzleClient(null as never);
}

export type DrizzleClient = ReturnType<typeof _inferType>;
export type Transaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];
export type Executor = DrizzleClient | Transaction;
