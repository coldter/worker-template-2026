/**
 * `liveOrganizations(executor)` — sanctioned read seam for the
 * `organization` table.
 *
 * The audit-logging invariant in `.agent-docs/audit-logging.md` requires
 * every read of `organizations` to filter `WHERE deleted_at IS NULL`.
 * Forgetting that filter is a tenancy security bug — a soft-deleted tenant
 * could resurface in a session-creation hook or in `/api/tenancy/current`.
 *
 * This module is the ONLY supported way for code outside `@repo/db` to
 * read organization rows. The shapes returned here pre-bind the
 * `deleted_at IS NULL` predicate so callers cannot accidentally drop it.
 *
 * Permitted exceptions are listed in
 * `packages/db/__tests__/live-organizations.spec.ts` (ALLOWLIST). Each
 * entry must document why bypassing the helper is justified.
 */

import { and, type Column, eq, isNull, type SQL } from "drizzle-orm";
import type { DrizzleClient, Executor } from "./client";
import { organizations } from "./schema/organizations";

/**
 * The set of column maps Drizzle's `.select()` accepts. We re-derive the
 * parameter shape from `DrizzleClient["select"]` so callers pass the same
 * column-projection map they would pass to a raw builder.
 */
type SelectColumns = NonNullable<Parameters<DrizzleClient["select"]>[0]>;

/**
 * Resolved row shape for a column-projection map. Drizzle's row type
 * picks the inferred TS type from each column entry; we mirror that
 * mapping here using the column's `_.data` slot.
 *
 * This intentionally mirrors a small subset of Drizzle's `SelectResult`
 * type. It only handles the `Column`-keyed case (`{ id: organizations.id }`)
 * which covers every callsite in this repo.
 */
type RowOf<TColumns extends SelectColumns> = {
  [K in keyof TColumns]: TColumns[K] extends Column<infer Cfg>
    ? Cfg extends { notNull: true; data: infer D }
      ? D
      : Cfg extends { data: infer D }
        ? D | null
        : unknown
    : unknown;
};

/**
 * Internal helper: AND-merge the soft-delete predicate into the caller's
 * `where` chunk. Accepts undefined for callers that have no extra predicate.
 */
function withLivePredicate(extra?: SQL): SQL {
  const live = isNull(organizations.deletedAt);
  if (!extra) {
    return live;
  }
  const merged = and(live, extra);
  if (!merged) {
    // Defensive: drizzle's and() returns undefined only when both inputs
    // are falsy, which is impossible here because `live` is always set.
    throw new Error("liveOrganizations: failed to compose predicate");
  }
  return merged;
}

/**
 * Live-organizations builder. Returns a small object with read shapes
 * that all carry the `deleted_at IS NULL` predicate.
 *
 * Each `select*` method materializes the query and returns
 * `Promise<Row[]>`. Callers can pass the result through `firstOrNull` /
 * `firstOrThrow` from `@repo/db` to collapse to a single row or null.
 */
export function liveOrganizations(executor: Executor) {
  // boundary: Drizzle vendor-SDK generic variance. The `Executor` union
  // (`DrizzleClient | Transaction`) makes builder chains produce a union
  // of `PgAsyncSelectBase` variants where an `Omit<..., string>` branch
  // strips `then`, breaking `await`/`PromiseLike` consumers. Both runtime
  // values are equivalent for `.select()` and `.query`, so we narrow to a
  // single concrete shape for builder inference downstream.
  const exec = executor as DrizzleClient;

  return {
    /**
     * `executor.select(columns).from(organizations).where(...)` pre-bound
     * with the soft-delete filter. Pass an optional extra predicate; it
     * will be AND-merged with `deletedAt IS NULL`. Returns a clean
     * `Promise<Row[]>` so downstream `firstOrNull` / `await` consumers see
     * a stable shape.
     */
    select<TColumns extends SelectColumns>(
      columns: TColumns,
      extraWhere?: SQL
    ): Promise<RowOf<TColumns>[]> {
      // boundary: Drizzle's `.where()` return type is
      // `Omit<PgAsyncSelectBase<..., string, ...>, string>` in the worst
      // case where `TExcludedMethods` widens to `string`, which strips
      // every key including `then`. The runtime is `PgAsyncSelectBase`
      // (extends `QueryPromise<TResult>`) and resolves to `TResult` —
      // exactly `RowOf<TColumns>[]`. The cast collapses the type union.
      return exec
        .select(columns)
        .from(organizations)
        .where(withLivePredicate(extraWhere)) as unknown as Promise<
        RowOf<TColumns>[]
      >;
    },

    /**
     * Convenience: lookup live organization rows by id. Returns at most
     * one row because `id` is the primary key.
     */
    selectById<TColumns extends SelectColumns>(
      columns: TColumns,
      organizationId: string
    ): Promise<RowOf<TColumns>[]> {
      // boundary: same Drizzle builder generic variance as `select(...)`.
      return exec
        .select(columns)
        .from(organizations)
        .where(
          withLivePredicate(eq(organizations.id, organizationId))
        ) as unknown as Promise<RowOf<TColumns>[]>;
    },

    /**
     * Convenience: lookup live organization rows by slug. Returns at most
     * one row because `slug` is uniquely indexed (excluding tombstones).
     */
    selectBySlug<TColumns extends SelectColumns>(
      columns: TColumns,
      slug: string
    ): Promise<RowOf<TColumns>[]> {
      // boundary: same Drizzle builder generic variance as `select(...)`.
      return exec
        .select(columns)
        .from(organizations)
        .where(
          withLivePredicate(eq(organizations.slug, slug))
        ) as unknown as Promise<RowOf<TColumns>[]>;
    },

    /**
     * Relational-query passthrough. Wraps
     * `executor.query.organizations.findFirst` and AND-merges the
     * soft-delete filter into the caller's `where` clause.
     */
    findFirst(
      args: NonNullable<
        Parameters<Executor["query"]["organizations"]["findFirst"]>[0]
      >
    ) {
      const callerWhere = args.where;
      // `as const` preserves the `true` literal that the relational query
      // builder requires for the `{ isNull: true }` predicate shape.
      const livePredicate = { deletedAt: { isNull: true } } as const;
      const mergedWhere =
        callerWhere && typeof callerWhere === "object"
          ? { AND: [callerWhere, livePredicate] }
          : livePredicate;
      return exec.query.organizations.findFirst({
        ...args,
        where: mergedWhere,
      });
    },
  };
}

export type LiveOrganizations = ReturnType<typeof liveOrganizations>;
