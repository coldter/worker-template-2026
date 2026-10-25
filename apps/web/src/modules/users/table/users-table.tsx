import { getRouteApi } from "@tanstack/react-router";

import type { ListUsersData } from "@/api.gen/types.gen";
import { useServerTable, useServerTableState } from "@/hooks/use-server-table";
import {
  DataTable,
  DataTablePagination,
  DataTableToolbar,
} from "@/modules/data-table";
import type { UsersSearch } from "@/routes/(protected)/users/index";

import { useUsersQuery } from "../query";
import type { User } from "../types";
import { usersColumns } from "./columns";

type UsersQueryParams = NonNullable<ListUsersData["query"]>;

const usersRoute = getRouteApi("/(protected)/users/");

export const UsersTable = () => {
  const navigate = usersRoute.useNavigate();
  const search = usersRoute.useSearch();

  const state = useServerTableState<UsersSearch, UsersQueryParams>({
    buildQueryParams: ({ page, perPage, sort, search: tableSearch }) => ({
      order: sort.desc ? "desc" : "asc",
      page,
      perPage,
      role: tableSearch.role,
      search: tableSearch.search,
      sort: sort.id,
      status: tableSearch.status,
    }),
    defaultSort: "createdAt",
    globalFilterKey: "search",
    navigate,
    pageSizeKey: "perPage",
    search,
  });

  const query = useUsersQuery(state.queryParams);

  const { table, rows, isLoading, isError } = useServerTable<
    User,
    UsersSearch,
    UsersQueryParams
  >({ columns: usersColumns, query, state });

  return (
    <div className="space-y-4">
      <DataTableToolbar searchPlaceholder="Search users..." table={table} />
      <DataTable
        columns={usersColumns}
        data={rows}
        emptyMessage="No users found."
        isError={isError}
        isLoading={isLoading}
        table={table}
      />
      <DataTablePagination table={table} />
    </div>
  );
};
