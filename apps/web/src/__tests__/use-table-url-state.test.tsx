import { isFunction } from "@tanstack/react-table";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useServerTable, useServerTableState } from "@/hooks/use-server-table";
import type { RouteNavigateFn } from "@/hooks/use-server-table";
import { useTableUrlState } from "@/hooks/use-table-url-state";
import type { NavigateFn, SearchRecord } from "@/hooks/use-table-url-state";

describe(useTableUrlState, () => {
  it("derives pagination from a custom page size key", () => {
    const { result } = renderHook(() =>
      useTableUrlState({
        navigate: vi.fn<NavigateFn>(),
        pagination: { defaultPageSize: 20, pageSizeKey: "perPage" },
        search: { page: 3, perPage: 50 },
      })
    );

    expect(result.current.pagination).toStrictEqual({
      pageIndex: 2,
      pageSize: 50,
    });
  });

  it("derives the global filter from the URL and stays in sync", () => {
    const navigate = vi.fn<NavigateFn>();

    const { result, rerender } = renderHook(
      ({ search }: { search: SearchRecord }) =>
        useTableUrlState({
          globalFilter: { key: "search" },
          navigate,
          search,
        }),
      { initialProps: { search: { search: "ada" } } }
    );

    expect(result.current.globalFilter).toBe("ada");

    rerender({ search: { search: "grace" } });
    expect(result.current.globalFilter).toBe("grace");

    act(() => result.current.onGlobalFilterChange?.("hopper"));
    expect(navigate).toHaveBeenCalledOnce();

    const [call] = navigate.mock.calls[0] ?? [];
    const update = call?.search;

    if (!isFunction(update)) {
      throw new Error("Expected the navigate search update to be a function");
    }

    expect(update({ search: "grace" })).toStrictEqual({
      page: undefined,
      search: "hopper",
    });
  });

  it("derives column filters from search params", () => {
    const { result } = renderHook(() =>
      useTableUrlState({
        columnFilters: [
          { columnId: "status", searchKey: "status", type: "string" },
        ],
        navigate: vi.fn<NavigateFn>(),
        search: { status: "active" },
      })
    );

    expect(result.current.columnFilters).toStrictEqual([
      { id: "status", value: "active" },
    ]);
  });
});

describe(useServerTable, () => {
  it("wires the configured global filter and page size keys into table state", () => {
    const routeNavigate =
      vi.fn<RouteNavigateFn<{ perPage: number; search: string }>>();

    const search = { perPage: 50, search: "ada" };

    const { result } = renderHook(() => {
      const state = useServerTableState({
        buildQueryParams: ({ page, perPage, search: currentSearch }) => ({
          page,
          perPage,
          search: currentSearch.search,
        }),
        globalFilterKey: "search",
        navigate: routeNavigate,
        pageSizeKey: "perPage",
        search,
      });

      return useServerTable({
        columns: [],
        query: {
          data: { data: [], meta: { pageCount: 1, total: 0 } },
          isError: false,
          isLoading: false,
        },
        state,
      });
    });

    expect(result.current.table.state.globalFilter).toBe("ada");
    expect(result.current.table.state.pagination.pageSize).toBe(50);
  });
});
