import { timestamp } from "drizzle-orm/pg-core";

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const timestamps = () =>
  ({
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  }) as const;

export async function firstOrNull<T>(query: Promise<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

export async function firstOrThrow<T>(
  query: Promise<T[]>,
  message = "Row not found"
): Promise<T> {
  const rows = await query;
  const [row] = rows;

  if (row === undefined || row === null) {
    throw new Error(message);
  }
  return row;
}
