/**
 * Row-array helpers for single-row lookups.
 *
 * Use inside services / handlers that build a Drizzle query and want to
 * collapse the resulting array into either the first row or null/throw.
 */

/**
 * Resolve a query that returns an array of rows and return the first row
 * or `null` when the array is empty. Use for single-row lookups where the
 * caller will handle the null case explicitly.
 *
 * Accepts `PromiseLike` to support Drizzle's lazy `QueryPromise` builders,
 * which implement `then` but are not nominally `Promise<T[]>`.
 */
export async function firstOrNull<T>(
  query: PromiseLike<T[]>
): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

/**
 * Resolve a query that returns an array of rows and return the first row
 * or throw when the array is empty. Use for single-row lookups where the
 * row is known to exist and the caller wants to bail loudly otherwise.
 */
export async function firstOrThrow<T>(
  query: PromiseLike<T[]>,
  message = "Row not found"
): Promise<T> {
  const rows = await query;
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }
  return row;
}
