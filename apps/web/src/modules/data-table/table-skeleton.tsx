import { Skeleton } from "@/modules/ui/skeleton";
import { TableCell, TableRow } from "@/modules/ui/table";

interface TableSkeletonProps {
  columnCount: number;
  rowCount?: number;
}

export const TableSkeleton = ({
  columnCount,
  rowCount = 10,
}: TableSkeletonProps) =>
  Array.from({ length: rowCount }).map((_, i) => (
    <TableRow key={`skeleton-row-${i}`}>
      {Array.from({ length: columnCount }).map((_cell, j) => (
        <TableCell key={`skeleton-cell-${i}-${j}`}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
