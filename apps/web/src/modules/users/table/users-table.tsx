import type { ListUsersData } from "@/api.gen/types.gen";
import { useServerTable } from "@/hooks/use-server-table";
import {
  DataTable,
  DataTablePagination,
  DataTableToolbar,
} from "@/modules/data-table";
import { Route, type UsersSearch } from "@/routes/(protected)/users/index";

import { useUsersQuery } from "../query";
import type { User } from "../types";
import { usersColumns } from "./columns";

type UsersQueryParams = NonNullable<ListUsersData["query"]>;

export function UsersTable() {
  const { table, rows, isLoading, isError } = useServerTable<
    User,
    UsersSearch,
    UsersQueryParams
  >({
    buildQueryParams: ({ page, perPage, sort, search }) => ({
      order: sort.desc ? "desc" : "asc",
      page,
      perPage,
      role: search.role,
      search: search.search,
      sort: sort.id,
      status: search.status,
    }),
    columns: usersColumns,
    defaultSort: "createdAt",
    route: Route,
    useData: useUsersQuery,
  });

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
}
