import { flexRender } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

import { useServerTable } from "@/hooks/use-server-table";
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
import {
  type AuditLogsSearch,
  Route,
} from "@/routes/(protected)/audit-logs/index";

import { AuditLogDetailSheet } from "../detail";
import { type AuditLogsQueryParams, useAuditLogsQuery } from "../query";
import { type AuditLog, auditLogsColumns } from "./columns";
import { AuditLogsFilters } from "./filters";
import { AuditLogsHeader } from "./header";

type AuditLogId = AuditLog["id"];

export function AuditLogsTable() {
  const [selectedLogId, setSelectedLogId] = useState<AuditLogId | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { table, navigate, search, rows, isLoading, isError, total } =
    useServerTable<AuditLog, AuditLogsSearch, AuditLogsQueryParams>({
      buildQueryParams: ({ page, perPage, sort, search: s }) => ({
        actorId: s.actorId,
        event: s.event,
        order: sort.desc ? "desc" : "asc",
        page,
        perPage,
        sort: sort.id,
        targetType: s.targetType,
      }),
      columns: auditLogsColumns,
      defaultSort: "createdAt",
      route: Route,
      useData: useAuditLogsQuery,
    });

  const selectedLog = useMemo(() => {
    if (!selectedLogId) {
      return null;
    }
    return rows.find((row) => row.id === selectedLogId) ?? null;
  }, [rows, selectedLogId]);

  // Close sheet when selected row drops out of the current page after refetch.
  useEffect(() => {
    if (detailOpen && selectedLogId && !selectedLog) {
      setDetailOpen(false);
      setSelectedLogId(null);
    }
  }, [detailOpen, selectedLogId, selectedLog]);

  function handleRowClick(log: AuditLog) {
    setSelectedLogId(log.id);
    setDetailOpen(true);
  }

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
        onClick={() => handleRowClick(row.original)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleRowClick(row.original);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
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
        onOpenChange={setDetailOpen}
        open={detailOpen}
      />
    </div>
  );
}
