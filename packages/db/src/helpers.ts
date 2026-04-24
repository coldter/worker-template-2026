import { timestamp } from "drizzle-orm/pg-core";

/**
 * Auto-set created timestamp on insert (UTC with timezone).
 * Use for tracking when records are created.
 */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/**
 * Auto-update timestamp on change (UTC with timezone).
 * Use for tracking when records are modified.
 */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/**
 * Resolve a query that returns an array of rows and return the first row
 * or `null` when the array is empty. Use for single-row lookups where the
 * caller will handle the null case explicitly.
 */
export async function firstOrNull<T>(query: Promise<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

/**
 * Resolve a query that returns an array of rows and return the first row
 * or throw when the array is empty. Use for single-row lookups where the
 * row is known to exist and the caller wants to bail loudly otherwise.
 */
export async function firstOrThrow<T>(
  query: Promise<T[]>,
  message = "Row not found"
): Promise<T> {
  const rows = await query;
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }
  return row;
}
