import {
  type ColumnDef,
  getCoreRowModel,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect } from "react";

import { type NavigateFn, useTableUrlState } from "@/hooks/use-table-url-state";

type SearchRecord = Record<string, unknown>;

type RouteNavigateOpts<TSearch> = {
  search: true | TSearch | ((prev: TSearch) => TSearch | Partial<TSearch>);
  replace?: boolean;
};

type RouteNavigateFn<TSearch> = (opts: RouteNavigateOpts<TSearch>) => void;

export type ServerTableRoute<TSearch extends SearchRecord> = {
  useNavigate: () => RouteNavigateFn<TSearch>;
  useSearch: () => TSearch;
};

type QueryResultLike<TRow> = {
  data?: {
    data: TRow[];
    meta: { pageCount: number; total: number };
  };
  isLoading: boolean;
  isError: boolean;
};

type SortState = { id?: string; desc?: boolean };

type BuildQueryParamsArgs<TSearch> = {
  page: number;
  perPage: number;
  sort: SortState;
  search: TSearch;
};

type UseServerTableParams<TRow, TSearch extends SearchRecord, TQueryParams> = {
  route: ServerTableRoute<TSearch>;
  columns: ColumnDef<TRow>[];
  buildQueryParams: (args: BuildQueryParamsArgs<TSearch>) => TQueryParams;
  useData: (params: TQueryParams) => QueryResultLike<TRow>;
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
};

type UseServerTableResult<TRow, TSearch extends SearchRecord> = {
  table: Table<TRow>;
  navigate: NavigateFn;
  search: TSearch;
  rows: TRow[];
  isLoading: boolean;
  isError: boolean;
  pageCount: number;
  total: number | undefined;
};

export function useServerTable<
  TRow,
  TSearch extends SearchRecord,
  TQueryParams,
>(
  params: UseServerTableParams<TRow, TSearch, TQueryParams>
): UseServerTableResult<TRow, TSearch> {
  const {
    route,
    columns,
    buildQueryParams,
    useData,
    defaultPage = 1,
    defaultPageSize = 20,
    defaultSort,
    defaultOrder = "desc",
  } = params;

  const routeNavigate = route.useNavigate();
  const search = route.useSearch();

  const navigate: NavigateFn = ({ search: searchUpdate, replace }) => {
    if (typeof searchUpdate === "function") {
      routeNavigate({
        search: (prev: TSearch) => ({ ...prev, ...searchUpdate(prev) }),
        replace,
      });
      return;
    }
    if (searchUpdate === true) {
      routeNavigate({ search: true, replace });
      return;
    }
    routeNavigate({
      search: (prev: TSearch) => ({ ...prev, ...searchUpdate }),
      replace,
    });
  };

  const {
    pagination,
    onPaginationChange,
    sorting,
    onSortingChange,
    ensurePageInRange,
  } = useTableUrlState({
    search,
    navigate,
    pagination: { defaultPage, defaultPageSize },
    sorting: { defaultSort, defaultOrder },
  });

  const queryParams = buildQueryParams({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    sort: {
      id: sorting[0]?.id,
      desc: sorting[0]?.desc,
    },
    search,
  });

  const { data, isLoading, isError } = useData(queryParams);

  const pageCount = data?.meta.pageCount ?? 0;
  const rows = data?.data ?? [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: ensurePageInRange closes over latest search/navigate; only re-run on pageCount change.
  useEffect(() => {
    ensurePageInRange(pageCount);
  }, [pageCount]);

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting },
    onPaginationChange,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  return {
    table,
    navigate,
    search,
    rows,
    isLoading,
    isError,
    pageCount,
    total: data?.meta.total,
  };
}
