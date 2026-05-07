import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/**
 * Open a pg.Client, drop and recreate the public schema (clean slate),
 * run all Drizzle migrations forward, and return the connected client
 * for catalog assertion queries.
 *
 * The caller is responsible for calling `client.end()` when done.
 */
export async function runMigrations(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();

  // Drop and recreate for a clean migration run (including drizzle tracking schema)
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.query("CREATE SCHEMA public");

  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "./src/migrations" });

  return client;
}
