import { TableCell, TableRow } from "@/modules/ui/table";

interface TableErrorProps {
  message?: string;
  colSpan: number;
}

export const TableError = ({
  message = "Failed to load data.",
  colSpan,
}: TableErrorProps) => (
  <TableRow>
    <TableCell className="text-destructive h-24 text-center" colSpan={colSpan}>
      {message}
    </TableCell>
  </TableRow>
);
