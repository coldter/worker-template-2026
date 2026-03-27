import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { relations } from "@/db/relations";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import { auditLogs } from "@/db/schema/audit-logs";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
export const db = drizzle({ client, schema, relations, casing: "snake_case" });

export const isUserSeeded = async () => {
  const usersInTable = await db.select().from(users).limit(1);
  return usersInTable.length > 0;
};

export const isAuditLogsSeeded = async () => {
  const logsInTable = await db.select().from(auditLogs).limit(1);
  return logsInTable.length > 0;
};
