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
    route: Route,
    columns: usersColumns,
    useData: useUsersQuery,
    defaultSort: "createdAt",
    buildQueryParams: ({ page, perPage, sort, search }) => ({
      page,
      perPage,
      sort: sort.id,
      order: sort.desc ? "desc" : "asc",
      search: search.search,
      status: search.status,
      role: search.role,
    }),
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
