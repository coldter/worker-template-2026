import { flexRender, type RowData, useTable } from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/table";
import { dataTableFeatures } from "./features";
import { TableEmpty } from "./table-empty";
import { TableError } from "./table-error";
import { TableSkeleton } from "./table-skeleton";
import type { DataTableProps } from "./types";

type DataTableViewProps<TData extends RowData> = {
  columns: DataTableProps<TData>["columns"];
  emptyMessage?: string;
  isError?: boolean;
  isLoading?: boolean;
  table: NonNullable<DataTableProps<TData>["table"]>;
};

function DataTableView<TData extends RowData>({
  columns,
  emptyMessage,
  isError,
  isLoading,
  table,
}: DataTableViewProps<TData>) {
  const renderContent = () => {
    if (isError) {
      return <TableError colSpan={columns.length} />;
    }

    if (isLoading) {
      return <TableSkeleton columnCount={columns.length} />;
    }

    const { rows } = table.getRowModel();
    if (rows.length === 0) {
      return <TableEmpty colSpan={columns.length} message={emptyMessage} />;
    }

    return rows.map((row) => (
      <TableRow data-state={row.getIsSelected() && "selected"} key={row.id}>
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    ));
  };

  return (
    <div className="rounded-md border">
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
  );
}

function InternalDataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage,
  isError,
  isLoading,
  ...tableProps
}: Omit<DataTableProps<TData>, "table">) {
  const table = useTable({
    columns,
    data,
    features: dataTableFeatures,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    ...tableProps,
  });

  return (
    <DataTableView
      columns={columns}
      emptyMessage={emptyMessage}
      isError={isError}
      isLoading={isLoading}
      table={table}
    />
  );
}

export function DataTable<TData extends RowData>({
  columns,
  emptyMessage,
  isError,
  isLoading,
  table,
  ...tableProps
}: DataTableProps<TData>) {
  if (table) {
    return (
      <DataTableView
        columns={columns}
        emptyMessage={emptyMessage}
        isError={isError}
        isLoading={isLoading}
        table={table}
      />
    );
  }

  return (
    <InternalDataTable
      columns={columns}
      emptyMessage={emptyMessage}
      isError={isError}
      isLoading={isLoading}
      {...tableProps}
    />
  );
}
