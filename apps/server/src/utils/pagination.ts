import { resolveSortColumn } from "@repo/shared/pagination";
import type { SortOrder } from "@repo/shared/pagination";
import { asc, desc } from "drizzle-orm";
import type { Column, SQL } from "drizzle-orm";

export type { PaginationQuery, SortOrder } from "@repo/shared/pagination";

export {
  createPaginatedResponse,
  createPaginatedResponseSchema,
  getPaginationParams,
  paginationQuerySchema,
} from "@repo/shared/pagination";

export const buildOrderBy = <T extends Record<string, Column>>(
  columns: T,
  sort: string | undefined,
  order: SortOrder,
  fallback: T[keyof T]
): SQL => {
  const column = resolveSortColumn(columns, sort, fallback);

  return order === "asc" ? asc(column) : desc(column);
};
