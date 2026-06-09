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

export async function withDrizzleClient<T>(
  connectionString: string,
  callback: (db: DrizzleClient) => Promise<T>,
  options?: WithDrizzleClientOptions
): Promise<T> {
  const client = new Client({ connectionString });
  // pg's connect() no-arg overload resolves to Promise<Client>; the callback
  // overload returns void, so we pin the type to the promise form we use.
  let connectPromise: Promise<Client> | undefined;
  const ensureConnected = () => {
    if (!connectPromise) {
      connectPromise = client.connect();
    }
    return connectPromise;
  };
  const originalQuery = client.query.bind(client);
  // boundary: pg.Client.query has many overloads; drizzle only uses the promise form. We wrap it to connect lazily on first query.
  client.query = ((...queryArgs: Parameters<typeof originalQuery>) =>
    ensureConnected().then(() =>
      originalQuery(...queryArgs)
    )) as typeof client.query;
  const db = createDrizzleClient(client, options?.logger);
  try {
    return await callback(db);
  } finally {
    if (connectPromise) {
      // Only tear down if a connection was actually established (or attempted).
      const endPromise = connectPromise.then(
        () => client.end(),
        () => undefined
      );
      if (options?.waitUntil) {
        options.waitUntil(endPromise);
      } else {
        await endPromise;
      }
    }
  }
}

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;
export type Transaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];
export type Executor = DrizzleClient | Transaction;
