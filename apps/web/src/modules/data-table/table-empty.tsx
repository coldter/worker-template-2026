import { TableCell, TableRow } from "@/modules/ui/table";

interface TableEmptyProps {
  message?: string;
  colSpan: number;
}

export const TableEmpty = ({
  message = "No results found.",
  colSpan,
}: TableEmptyProps) => (
  <TableRow>
    <TableCell className="h-24 text-center" colSpan={colSpan}>
      {message}
    </TableCell>
  </TableRow>
);
