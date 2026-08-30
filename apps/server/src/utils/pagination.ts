import { resolveSortColumn, type SortOrder } from "@repo/shared/pagination";
import { asc, type Column, desc, type SQL } from "drizzle-orm";

export type {
  PaginatedResponse,
  PaginationMeta,
  PaginationQuery,
  SortOrder,
} from "@repo/shared/pagination";
export {
  createPaginatedResponse,
  createPaginatedResponseSchema,
  getPaginationParams,
  PAGINATION_DEFAULTS,
  paginationMetaSchema,
  paginationQuerySchema,
  resolveSortColumn,
  sortOrderSchema,
} from "@repo/shared/pagination";

export function buildOrderBy<T extends Record<string, Column>>(
  columns: T,
  sort: string | undefined,
  order: SortOrder,
  fallback: T[keyof T]
): SQL {
  const column = resolveSortColumn(columns, sort, fallback);
  return order === "asc" ? asc(column) : desc(column);
}
