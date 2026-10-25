import { getRouteApi } from "@tanstack/react-router";
import { flexRender } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { useServerTable, useServerTableState } from "@/hooks/use-server-table";
import { DataTablePagination } from "@/modules/data-table";
import { TableEmpty } from "@/modules/data-table/table-empty";
import { TableError } from "@/modules/data-table/table-error";
import { TableSkeleton } from "@/modules/data-table/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/table";
import type { AuditLogsSearch } from "@/routes/(protected)/audit-logs/index";

import { AuditLogDetailSheet } from "../detail";
import { useAuditLogsQuery } from "../query";
import type { AuditLogsQueryParams } from "../query";
import { auditLogsColumns } from "./columns";
import type { AuditLog } from "./columns";
import { AuditLogsFilters } from "./filters";
import { AuditLogsHeader } from "./header";

const auditLogsRoute = getRouteApi("/(protected)/audit-logs/");

type AuditLogId = AuditLog["id"];

export const AuditLogsTable = () => {
  const [selectedLogId, setSelectedLogId] = useState<AuditLogId | null>(null);

  const routeNavigate = auditLogsRoute.useNavigate();
  const routeSearch = auditLogsRoute.useSearch();

  const state = useServerTableState<AuditLogsSearch, AuditLogsQueryParams>({
    buildQueryParams: ({ page, perPage, sort, search: s }) => ({
      actorId: s.actorId,
      event: s.event,
      order: sort.desc ? "desc" : "asc",
      page,
      perPage,
      sort: sort.id,
      targetType: s.targetType,
    }),
    defaultSort: "createdAt",
    navigate: routeNavigate,
    pageSizeKey: "perPage",
    search: routeSearch,
  });

  const query = useAuditLogsQuery(state.queryParams);

  const { table, navigate, search, rows, isLoading, isError, total } =
    useServerTable<AuditLog, AuditLogsSearch, AuditLogsQueryParams>({
      columns: auditLogsColumns,
      query,
      state,
    });

  const selectedLog = useMemo(
    () =>
      selectedLogId === null
        ? null
        : (rows.find((row) => row.id === selectedLogId) ?? null),
    [rows, selectedLogId]
  );

  const renderContent = () => {
    if (isError) {
      return <TableError colSpan={auditLogsColumns.length} />;
    }

    if (isLoading) {
      return <TableSkeleton columnCount={auditLogsColumns.length} />;
    }

    const tableRows = table.getRowModel().rows;

    if (tableRows.length === 0) {
      return (
        <TableEmpty
          colSpan={auditLogsColumns.length}
          message="No audit logs found."
        />
      );
    }

    return tableRows.map((row) => (
      <TableRow
        className="cursor-pointer transition-colors"
        key={row.id}
        onClick={() => setSelectedLogId(row.original.id)}
      >
        {row.getVisibleCells().map((cell, index) =>
          index === 0 ? (
            <TableCell key={cell.id}>
              <button
                aria-label="View audit log details"
                className="cursor-pointer text-left"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedLogId(row.original.id);
                }}
                type="button"
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </button>
            </TableCell>
          ) : (
            <TableCell key={cell.id}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          )
        )}
      </TableRow>
    ));
  };

  return (
    <div className="@container/content space-y-4 p-6">
      <AuditLogsHeader totalCount={total} />

      <AuditLogsFilters navigate={navigate} search={search} />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>{renderContent()}</TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />

      <AuditLogDetailSheet
        log={selectedLog}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedLogId(null);
          }
        }}
        open={selectedLog !== null}
      />
    </div>
  );
};
