import { logger } from "@repo/shared/logger";
import type { Logger as DrizzleLoggerInterface } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { relations } from "./relations";

export const createDrizzleClient = (
  client: Client,
  drizzleLogger?: DrizzleLoggerInterface
) =>
  drizzle({
    client,
    relations,
    ...(drizzleLogger && { logger: drizzleLogger }),
  });

export interface WithDrizzleClientOptions {
  logger?: DrizzleLoggerInterface;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export const withDrizzleClient = async <T>(
  connectionString: string,
  run: (db: DrizzleClient) => Promise<T>,
  options?: WithDrizzleClientOptions
): Promise<T> => {
  const client = new Client({ connectionString });

  client.on("error", (error) => {
    logger.error("Postgres client error", { error });
  });

  let connectPromise: Promise<Client> | undefined;

  const ensureConnected = () => {
    if (!connectPromise) {
      connectPromise = client.connect();
    }

    return connectPromise;
  };

  const originalQuery = client.query.bind(client);

  // SAFETY: the wrapper forwards every call to the bound pg method after connecting, preserving each query overload's argument and return contract; no single arrow signature can be inferred against an overload set.
  client.query = ((...queryArgs: Parameters<typeof originalQuery>) =>
    ensureConnected().then(() =>
      originalQuery(...queryArgs)
    )) as typeof client.query;
  const db = createDrizzleClient(client, options?.logger);

  try {
    return await run(db);
  } finally {
    if (connectPromise) {
      const endPromise = connectPromise
        .then(() => client.end())
        .catch(() => null);

      if (options?.waitUntil) {
        options.waitUntil(endPromise);
      } else {
        await endPromise;
      }
    }
  }
};

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;

export type Transaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];

export type Executor = DrizzleClient | Transaction;
