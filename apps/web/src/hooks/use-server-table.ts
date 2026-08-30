import {
  type ColumnDef,
  type ReactTable,
  type RowData,
  useTable,
} from "@tanstack/react-table";
import { useEffect } from "react";

import { type NavigateFn, useTableUrlState } from "@/hooks/use-table-url-state";
import {
  type DataTableFeatures,
  dataTableFeatures,
} from "@/modules/data-table/features";

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

type UseServerTableParams<
  TRow extends RowData,
  TSearch extends SearchRecord,
  TQueryParams,
> = {
  route: ServerTableRoute<TSearch>;
  columns: ColumnDef<DataTableFeatures, TRow>[];
  buildQueryParams: (args: BuildQueryParamsArgs<TSearch>) => TQueryParams;
  useData: (params: TQueryParams) => QueryResultLike<TRow>;
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
};

type UseServerTableResult<
  TRow extends RowData,
  TSearch extends SearchRecord,
> = {
  table: ReactTable<DataTableFeatures, TRow>;
  navigate: NavigateFn;
  search: TSearch;
  rows: TRow[];
  isLoading: boolean;
  isError: boolean;
  pageCount: number;
  total: number | undefined;
};

export function useServerTable<
  TRow extends RowData,
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
        replace,
        search: (prev: TSearch) => ({ ...prev, ...searchUpdate(prev) }),
      });
      return;
    }
    if (searchUpdate === true) {
      routeNavigate({ replace, search: true });
      return;
    }
    routeNavigate({
      replace,
      search: (prev: TSearch) => ({ ...prev, ...searchUpdate }),
    });
  };

  const {
    pagination,
    onPaginationChange,
    sorting,
    onSortingChange,
    ensurePageInRange,
  } = useTableUrlState({
    navigate,
    pagination: { defaultPage, defaultPageSize },
    search,
    sorting: { defaultOrder, defaultSort },
  });

  const queryParams = buildQueryParams({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    search,
    sort: {
      desc: sorting[0]?.desc,
      id: sorting[0]?.id,
    },
  });

  const { data, isLoading, isError } = useData(queryParams);

  const pageCount = data?.meta.pageCount ?? 0;
  const rows = data?.data ?? [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: ensurePageInRange closes over latest search/navigate; only re-run on pageCount change.
  useEffect(() => {
    ensurePageInRange(pageCount);
  }, [pageCount]);

  const table = useTable({
    columns,
    data: rows,
    features: dataTableFeatures,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    onPaginationChange,
    onSortingChange,
    pageCount,
    state: { pagination, sorting },
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
}
