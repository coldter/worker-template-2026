import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { Pagination } from "@/modules/common/pagination";
import { Badge } from "@/modules/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/table";
import { globalAdminListQueryOptions, globalAdminPageSize } from "./query";

interface GlobalAdminsPageProps {
  page: number;
  setPage: (page: number) => void;
}

export function GlobalAdminsPage({ page, setPage }: GlobalAdminsPageProps) {
  const admins = useQuery(globalAdminListQueryOptions({ page }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-2xl">Global admins</h2>
        <p className="text-muted-foreground text-sm">
          Operators with access to this console.
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.isLoading ? (
              <TableRow>
                <TableCell colSpan={4}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!admins.isLoading && (admins.data?.data.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  No global admins.
                </TableCell>
              </TableRow>
            ) : null}
            {admins.data?.data.map((admin) => (
              <TableRow key={admin.id}>
                <TableCell>{admin.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{admin.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      admin.status === "active" ? "default" : "secondary"
                    }
                  >
                    {admin.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(admin.lastActiveAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {admins.data ? (
        <Pagination
          onPageChange={setPage}
          page={page}
          pageSize={globalAdminPageSize}
          total={admins.data.meta.total}
        />
      ) : null}
    </div>
  );
}
