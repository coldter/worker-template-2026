import { isFunction } from "@tanstack/react-table";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useServerTable } from "@/hooks/use-server-table";
import {
  type NavigateFn,
  type SearchRecord,
  useTableUrlState,
} from "@/hooks/use-table-url-state";

describe("useTableUrlState", () => {
  it("derives pagination from a custom page size key", () => {
    const { result } = renderHook(() =>
      useTableUrlState({
        navigate: vi.fn(),
        pagination: { defaultPageSize: 20, pageSizeKey: "perPage" },
        search: { page: 3, perPage: 50 },
      })
    );

    expect(result.current.pagination).toEqual({ pageIndex: 2, pageSize: 50 });
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
    expect(navigate).toHaveBeenCalledTimes(1);

    const [call] = navigate.mock.calls[0] ?? [];
    const update = call?.search;
    if (!isFunction(update)) {
      throw new Error("Expected the navigate search update to be a function");
    }

    expect(update({ search: "grace" })).toEqual({
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
        navigate: vi.fn(),
        search: { status: "active" },
      })
    );

    expect(result.current.columnFilters).toEqual([
      { id: "status", value: "active" },
    ]);
  });
});

describe("useServerTable", () => {
  it("wires the configured global filter and page size keys into table state", () => {
    const route = {
      useNavigate: () => vi.fn(),
      useSearch: () => ({ perPage: 50, search: "ada" }),
    };

    const { result } = renderHook(() =>
      useServerTable({
        buildQueryParams: ({ page, perPage, search }) => ({
          page,
          perPage,
          search: search.search,
        }),
        columns: [],
        globalFilterKey: "search",
        pageSizeKey: "perPage",
        route,
        useData: () => ({
          data: { data: [], meta: { pageCount: 1, total: 0 } },
          isError: false,
          isLoading: false,
        }),
      })
    );

    expect(result.current.table.state.globalFilter).toBe("ada");
    expect(result.current.table.state.pagination.pageSize).toBe(50);
  });
});
