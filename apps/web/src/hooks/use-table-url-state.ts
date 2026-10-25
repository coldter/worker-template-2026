import { functionalUpdate } from "@tanstack/react-table";
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";
import { useMemo } from "react";
import * as z from "zod/mini";

export type SearchParamValue =
  | readonly string[]
  | boolean
  | number
  | string
  | undefined;

export type SearchRecord = Record<string, SearchParamValue>;

export type SearchPatch = Partial<SearchRecord>;

export type NavigateFn = (opts: {
  search: true | SearchPatch | ((prev: SearchRecord) => SearchPatch);
  replace?: boolean;
}) => void;

type ColumnFilterConfig =
  | {
      columnId: string;
      searchKey: string;
      type?: "string";
      serialize?: (value: string) => SearchParamValue;
      deserialize?: (value: SearchParamValue) => string | undefined;
    }
  | {
      columnId: string;
      searchKey: string;
      type: "array";
      serialize?: (value: readonly string[]) => SearchParamValue;
      deserialize?: (value: SearchParamValue) => readonly string[] | undefined;
    };

interface UseTableUrlStateParams {
  search: SearchRecord;
  navigate: NavigateFn;
  pagination?: {
    pageKey?: string;
    pageSizeKey?: string;
    defaultPage?: number;
    defaultPageSize?: number;
  };
  sorting?: {
    sortKey?: string;
    orderKey?: string;
    defaultSort?: string;
    defaultOrder?: "asc" | "desc";
  };
  globalFilter?: {
    enabled?: boolean;
    key?: string;
    trim?: boolean;
  };
  columnFilters?: ColumnFilterConfig[];
}

interface UseTableUrlStateReturn {
  globalFilter?: string;
  onGlobalFilterChange?: OnChangeFn<string>;
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  ensurePageInRange: (
    pageCount: number,
    opts?: { resetTo?: "first" | "last" }
  ) => void;
}

const numberParamSchema = z.number();
const stringParamSchema = z.string();
const stringArrayParamSchema = z.array(z.string());

const EMPTY_COLUMN_FILTERS: ColumnFilterConfig[] = [];

const readNumberParam = (
  search: SearchRecord,
  key: string
): number | undefined => {
  const parsed = numberParamSchema.safeParse(search[key]);

  return parsed.success ? parsed.data : undefined;
};

const readStringParam = (
  search: SearchRecord,
  key: string
): string | undefined => {
  const parsed = stringParamSchema.safeParse(search[key]);

  return parsed.success ? parsed.data : undefined;
};

const readStringArrayParam = (
  search: SearchRecord,
  key: string
): readonly string[] | undefined => {
  const parsed = stringArrayParamSchema.safeParse(search[key]);

  return parsed.success ? parsed.data : undefined;
};

const deriveColumnFilters = (
  search: SearchRecord,
  columnFiltersCfg: ColumnFilterConfig[]
): ColumnFiltersState => {
  const collected: ColumnFiltersState = [];

  for (const cfg of columnFiltersCfg) {
    if (cfg.type === "array") {
      const value = cfg.deserialize
        ? (cfg.deserialize(search[cfg.searchKey]) ?? [])
        : (readStringArrayParam(search, cfg.searchKey) ?? []);

      if (value.length > 0) {
        collected.push({ id: cfg.columnId, value });
      }

      continue;
    }

    const value = cfg.deserialize
      ? (cfg.deserialize(search[cfg.searchKey]) ?? "")
      : (readStringParam(search, cfg.searchKey) ?? "");

    if (value.trim() !== "") {
      collected.push({ id: cfg.columnId, value });
    }
  }

  return collected;
};

const derivePagination = (
  search: SearchRecord,
  pageKey: string,
  pageSizeKey: string,
  defaultPage: number,
  defaultPageSize: number
): PaginationState => {
  const pageNum = readNumberParam(search, pageKey) ?? defaultPage;
  const pageSizeNum = readNumberParam(search, pageSizeKey) ?? defaultPageSize;

  return { pageIndex: Math.max(0, pageNum - 1), pageSize: pageSizeNum };
};

const deriveSorting = (
  search: SearchRecord,
  sortKey: string,
  orderKey: string,
  defaultSort: string | undefined,
  defaultOrder: "asc" | "desc"
): SortingState => {
  const id = readStringParam(search, sortKey) ?? defaultSort;
  const rawOrder = readStringParam(search, orderKey);
  const desc = rawOrder === "desc" || (!rawOrder && defaultOrder === "desc");

  return id ? [{ desc, id }] : [];
};

interface PaginationChangeOptions {
  navigate: NavigateFn;
  pagination: PaginationState;
  pageKey: string;
  pageSizeKey: string;
  defaultPage: number;
  defaultPageSize: number;
}

const createPaginationChangeHandler =
  ({
    navigate,
    pagination,
    pageKey,
    pageSizeKey,
    defaultPage,
    defaultPageSize,
  }: PaginationChangeOptions): OnChangeFn<PaginationState> =>
  (updater) => {
    const next = functionalUpdate(updater, pagination);
    const nextPage = next.pageIndex + 1;
    const nextPageSize = next.pageSize;

    navigate({
      search: (prev) => ({
        ...prev,
        [pageKey]: nextPage <= defaultPage ? undefined : nextPage,
        [pageSizeKey]:
          nextPageSize === defaultPageSize ? undefined : nextPageSize,
      }),
    });
  };

interface SortingChangeOptions {
  navigate: NavigateFn;
  sorting: SortingState;
  pageKey: string;
  sortKey: string;
  orderKey: string;
  defaultSort: string | undefined;
  defaultOrder: "asc" | "desc";
}

const createSortingChangeHandler =
  ({
    navigate,
    sorting,
    pageKey,
    sortKey,
    orderKey,
    defaultSort,
    defaultOrder,
  }: SortingChangeOptions): OnChangeFn<SortingState> =>
  (updater) => {
    const next = functionalUpdate(updater, sorting);
    const [first] = next;

    let nextOrder: "asc" | "desc" | undefined;

    if (first) {
      if (first.desc === (defaultOrder === "desc")) {
        nextOrder = undefined;
      } else {
        nextOrder = first.desc ? "desc" : "asc";
      }
    }

    navigate({
      search: (prev) => ({
        ...prev,
        [pageKey]: undefined,
        [sortKey]: first?.id === defaultSort ? undefined : first?.id,
        [orderKey]: nextOrder,
      }),
    });
  };

interface GlobalFilterChangeOptions {
  navigate: NavigateFn;
  globalFilter: string;
  pageKey: string;
  globalFilterKey: string;
  trimGlobal: boolean;
}

const createGlobalFilterChangeHandler =
  ({
    navigate,
    globalFilter,
    pageKey,
    globalFilterKey,
    trimGlobal,
  }: GlobalFilterChangeOptions): OnChangeFn<string> =>
  (updater) => {
    const next = functionalUpdate(updater, globalFilter);
    const value = trimGlobal ? next.trim() : next;

    navigate({
      search: (prev) => ({
        ...prev,
        [pageKey]: undefined,
        [globalFilterKey]: value || undefined,
      }),
    });
  };

interface ColumnFiltersChangeOptions {
  navigate: NavigateFn;
  columnFilters: ColumnFiltersState;
  columnFiltersCfg: ColumnFilterConfig[];
  pageKey: string;
}

const createColumnFiltersChangeHandler =
  ({
    navigate,
    columnFilters,
    columnFiltersCfg,
    pageKey,
  }: ColumnFiltersChangeOptions): OnChangeFn<ColumnFiltersState> =>
  (updater) => {
    const next = functionalUpdate(updater, columnFilters);

    const patch: SearchPatch = {};

    for (const cfg of columnFiltersCfg) {
      const found = next.find((filter) => filter.id === cfg.columnId);

      if (cfg.type === "array") {
        const parsed = stringArrayParamSchema.safeParse(found?.value);
        const value = parsed.success ? parsed.data : [];

        const serialize =
          cfg.serialize ?? ((serialized: readonly string[]) => serialized);

        patch[cfg.searchKey] = value.length > 0 ? serialize(value) : undefined;
        continue;
      }

      const parsed = stringParamSchema.safeParse(found?.value);
      const value = parsed.success ? parsed.data : "";
      const serialize = cfg.serialize ?? ((serialized: string) => serialized);

      patch[cfg.searchKey] = value.trim() === "" ? undefined : serialize(value);
    }

    navigate({
      search: (prev) => ({
        ...prev,
        [pageKey]: undefined,
        ...patch,
      }),
    });
  };

interface EnsurePageInRangeOptions {
  navigate: NavigateFn;
  search: SearchRecord;
  pageKey: string;
  defaultPage: number;
}

const createEnsurePageInRange =
  ({ navigate, search, pageKey, defaultPage }: EnsurePageInRangeOptions) =>
  (pageCount: number, opts?: { resetTo?: "first" | "last" }): void => {
    const pageNum = readNumberParam(search, pageKey) ?? defaultPage;

    if (pageCount > 0 && pageNum > pageCount) {
      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          [pageKey]:
            (opts?.resetTo ?? "first") === "last" ? pageCount : undefined,
        }),
      });
    }
  };

interface ResolvedPaginationConfig {
  pageKey: string;
  pageSizeKey: string;
  defaultPage: number;
  defaultPageSize: number;
}

const resolvePaginationConfig = (
  cfg: UseTableUrlStateParams["pagination"]
): ResolvedPaginationConfig => ({
  defaultPage: cfg?.defaultPage ?? 1,
  defaultPageSize: cfg?.defaultPageSize ?? 10,
  pageKey: cfg?.pageKey ?? "page",
  pageSizeKey: cfg?.pageSizeKey ?? "pageSize",
});

interface ResolvedSortingConfig {
  sortKey: string;
  orderKey: string;
  defaultSort: string | undefined;
  defaultOrder: "asc" | "desc";
}

const resolveSortingConfig = (
  cfg: UseTableUrlStateParams["sorting"]
): ResolvedSortingConfig => ({
  defaultOrder: cfg?.defaultOrder ?? "desc",
  defaultSort: cfg?.defaultSort,
  orderKey: cfg?.orderKey ?? "order",
  sortKey: cfg?.sortKey ?? "sort",
});

interface ResolvedGlobalFilterConfig {
  globalFilterKey: string;
  globalFilterEnabled: boolean;
  trimGlobal: boolean;
}

const resolveGlobalFilterConfig = (
  cfg: UseTableUrlStateParams["globalFilter"]
): ResolvedGlobalFilterConfig => ({
  globalFilterEnabled: cfg?.enabled ?? true,
  globalFilterKey: cfg?.key ?? "filter",
  trimGlobal: cfg?.trim ?? true,
});

export const useTableUrlState = ({
  search,
  navigate,
  pagination: paginationCfg,
  sorting: sortingCfg,
  globalFilter: globalFilterCfg,
  columnFilters: columnFiltersCfg = EMPTY_COLUMN_FILTERS,
}: UseTableUrlStateParams): UseTableUrlStateReturn => {
  const { defaultPage, defaultPageSize, pageKey, pageSizeKey } =
    resolvePaginationConfig(paginationCfg);

  const { defaultOrder, defaultSort, orderKey, sortKey } =
    resolveSortingConfig(sortingCfg);

  const { globalFilterEnabled, globalFilterKey, trimGlobal } =
    resolveGlobalFilterConfig(globalFilterCfg);

  const columnFilters = useMemo(
    () => deriveColumnFilters(search, columnFiltersCfg),
    [columnFiltersCfg, search]
  );

  const pagination = useMemo(
    () =>
      derivePagination(
        search,
        pageKey,
        pageSizeKey,
        defaultPage,
        defaultPageSize
      ),
    [search, pageKey, pageSizeKey, defaultPage, defaultPageSize]
  );

  const sorting = useMemo(
    () => deriveSorting(search, sortKey, orderKey, defaultSort, defaultOrder),
    [search, sortKey, orderKey, defaultSort, defaultOrder]
  );

  const globalFilter = globalFilterEnabled
    ? (readStringParam(search, globalFilterKey) ?? "")
    : undefined;

  const onPaginationChange = createPaginationChangeHandler({
    defaultPage,
    defaultPageSize,
    navigate,
    pageKey,
    pageSizeKey,
    pagination,
  });

  const onSortingChange = createSortingChangeHandler({
    defaultOrder,
    defaultSort,
    navigate,
    orderKey,
    pageKey,
    sortKey,
    sorting,
  });

  const onGlobalFilterChange = globalFilterEnabled
    ? createGlobalFilterChangeHandler({
        globalFilter: globalFilter ?? "",
        globalFilterKey,
        navigate,
        pageKey,
        trimGlobal,
      })
    : undefined;

  const onColumnFiltersChange = createColumnFiltersChangeHandler({
    columnFilters,
    columnFiltersCfg,
    navigate,
    pageKey,
  });

  const ensurePageInRange = createEnsurePageInRange({
    defaultPage,
    navigate,
    pageKey,
    search,
  });

  return {
    columnFilters,
    ensurePageInRange,
    globalFilter: globalFilterEnabled ? (globalFilter ?? "") : undefined,
    onColumnFiltersChange,
    onGlobalFilterChange,
    onPaginationChange,
    onSortingChange,
    pagination,
    sorting,
  };
};
