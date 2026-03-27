import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { DrizzleLogger } from "@/lib/logger-drizzle";
import { relations } from "./relations";
import * as schema from "./schema";

// Type helper: create a throwaway instance to infer the type, never called at runtime
function _inferType() {
  const client = new Client({ connectionString: "" });
  return drizzle({
    client,
    schema,
    relations,
    casing: "snake_case",
    logger: new DrizzleLogger(),
  });
}

export type DrizzleClient = ReturnType<typeof _inferType>;
export type Transaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];
export type Executor = DrizzleClient | Transaction;

export { relations } from "./relations";
// Re-export schema and relations for use in middleware and workflows
export { schema };
