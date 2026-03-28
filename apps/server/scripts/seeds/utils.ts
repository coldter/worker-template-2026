import { createDrizzleClient } from "@repo/db/client";
import { auditLogs, users } from "@repo/db/schema";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
export const db = createDrizzleClient(client);

export const isUserSeeded = async () => {
  const usersInTable = await db.select().from(users).limit(1);
  return usersInTable.length > 0;
};

export const isAuditLogsSeeded = async () => {
  const logsInTable = await db.select().from(auditLogs).limit(1);
  return logsInTable.length > 0;
};
