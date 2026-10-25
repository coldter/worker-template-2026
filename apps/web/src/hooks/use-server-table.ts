import { isFunction, useTable } from "@tanstack/react-table";
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  ReactTable,
  RowData,
  SortingState,
} from "@tanstack/react-table";
import { useEffect } from "react";

import { useTableUrlState } from "@/hooks/use-table-url-state";
import type {
  NavigateFn,
  SearchPatch,
  SearchRecord,
} from "@/hooks/use-table-url-state";
import { dataTableFeatures } from "@/modules/data-table/features";
import type { DataTableFeatures } from "@/modules/data-table/features";

const isSearchUpdater = (
  update: SearchPatch | ((prev: SearchRecord) => SearchPatch)
): update is (prev: SearchRecord) => SearchPatch => isFunction(update);

interface QueryResultLike<TRow> {
  data?: {
    data: TRow[];
    meta: { pageCount: number; total: number };
  };
  isLoading: boolean;
  isError: boolean;
}

interface SortState {
  id?: string;
  desc?: boolean;
}

interface BuildQueryParamsArgs<TSearch> {
  page: number;
  perPage: number;
  sort: SortState;
  search: TSearch;
}

export type RouteNavigateFn<TSearch extends SearchRecord> = (opts: {
  search: true | TSearch | ((prev: TSearch) => TSearch | Partial<TSearch>);
  replace?: boolean;
}) => void;

const createNavigate =
  <TSearch extends SearchRecord>(
    routeNavigate: RouteNavigateFn<TSearch>
  ): NavigateFn =>
  ({ search, replace }) => {
    if (search === true) {
      routeNavigate({ replace, search: true });

      return;
    }

    if (isSearchUpdater(search)) {
      routeNavigate({
        replace,
        search: (prev: TSearch) => ({ ...prev, ...search(prev) }),
      });

      return;
    }

    routeNavigate({
      replace,
      search: (prev: TSearch) => ({ ...prev, ...search }),
    });
  };

export interface ServerTableStateParams<
  TSearch extends SearchRecord,
  TQueryParams,
> {
  navigate: RouteNavigateFn<TSearch>;
  search: TSearch;
  buildQueryParams: (args: BuildQueryParamsArgs<TSearch>) => TQueryParams;
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
  globalFilterKey?: string;
  pageSizeKey?: string;
}

export interface ServerTableState<TSearch extends SearchRecord, TQueryParams> {
  navigate: NavigateFn;
  search: TSearch;
  queryParams: TQueryParams;
  pagination: PaginationState;
  sorting: SortingState;
  globalFilter?: string;
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
  onGlobalFilterChange?: OnChangeFn<string>;
  ensurePageInRange: (
    pageCount: number,
    opts?: { resetTo?: "first" | "last" }
  ) => void;
}

export const useServerTableState = <
  TSearch extends SearchRecord,
  TQueryParams,
>({
  navigate,
  search,
  buildQueryParams,
  defaultPage = 1,
  defaultPageSize = 20,
  defaultSort,
  defaultOrder = "desc",
  globalFilterKey,
  pageSizeKey,
}: ServerTableStateParams<TSearch, TQueryParams>): ServerTableState<
  TSearch,
  TQueryParams
> => {
  const tableNavigate = createNavigate(navigate);

  const urlState = useTableUrlState({
    navigate: tableNavigate,
    pagination: { defaultPage, defaultPageSize, pageSizeKey },
    search,
    sorting: { defaultOrder, defaultSort },
    ...(globalFilterKey && { globalFilter: { key: globalFilterKey } }),
  });

  const queryParams = buildQueryParams({
    page: urlState.pagination.pageIndex + 1,
    perPage: urlState.pagination.pageSize,
    search,
    sort: {
      desc: urlState.sorting[0]?.desc,
      id: urlState.sorting[0]?.id,
    },
  });

  return {
    ...urlState,
    navigate: tableNavigate,
    queryParams,
    search,
  };
};

interface UseServerTableParams<
  TRow extends RowData,
  TSearch extends SearchRecord,
  TQueryParams,
> {
  columns: ColumnDef<DataTableFeatures, TRow>[];
  state: ServerTableState<TSearch, TQueryParams>;
  query: QueryResultLike<TRow>;
}

interface UseServerTableResult<
  TRow extends RowData,
  TSearch extends SearchRecord,
> {
  table: ReactTable<DataTableFeatures, TRow>;
  navigate: NavigateFn;
  search: TSearch;
  rows: TRow[];
  isLoading: boolean;
  isError: boolean;
  pageCount: number;
  total: number | undefined;
}

export const useServerTable = <
  TRow extends RowData,
  TSearch extends SearchRecord,
  TQueryParams,
>({
  columns,
  state,
  query,
}: UseServerTableParams<TRow, TSearch, TQueryParams>): UseServerTableResult<
  TRow,
  TSearch
> => {
  const { data, isLoading, isError } = query;
  const pageCount = data?.meta.pageCount ?? 0;
  const rows = data?.data ?? [];

  const {
    ensurePageInRange,
    globalFilter,
    navigate,
    onGlobalFilterChange,
    onPaginationChange,
    onSortingChange,
    pagination,
    search,
    sorting,
  } = state;

  useEffect(() => {
    ensurePageInRange(pageCount);
  }, [ensurePageInRange, pageCount]);

  const table = useTable({
    columns,
    data: rows,
    features: dataTableFeatures,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    onPaginationChange,
    onSortingChange,
    ...(onGlobalFilterChange && { onGlobalFilterChange }),
    pageCount,
    state: {
      pagination,
      sorting,
      ...(globalFilter !== undefined && { globalFilter }),
    },
  });

  return {
    isError,
    isLoading,
    navigate,
    pageCount,
    rows,
    search,
    table,
    total: data?.meta.total,
  };
};
