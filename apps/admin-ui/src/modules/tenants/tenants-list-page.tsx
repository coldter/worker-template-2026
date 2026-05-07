import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { formatDate } from "@/lib/utils";
import { Pagination } from "@/modules/common/pagination";
import { useOperator } from "@/modules/operator/provider";
import { Badge } from "@/modules/ui/badge";
import { Button } from "@/modules/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/table";
import { tenantListPageSize, tenantListQueryOptions } from "./query";

interface TenantsListPageProps {
  page: number;
  setPage: (page: number) => void;
}

export function TenantsListPage({ page, setPage }: TenantsListPageProps) {
  const navigate = useNavigate();
  const { can } = useOperator();
  const tenants = useQuery(tenantListQueryOptions({ page }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-2xl">Tenants</h2>
          <p className="text-muted-foreground text-sm">
            Manage tenant organizations.
          </p>
        </div>
        {can("tenant.create") ? (
          <Button asChild>
            <Link to="/tenants/new">Create tenant</Link>
          </Button>
        ) : null}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.isLoading ? (
              <TableRow>
                <TableCell colSpan={4}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!tenants.isLoading && (tenants.data?.data.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  No tenants yet.
                </TableCell>
              </TableRow>
            ) : null}
            {tenants.data?.data.map((tenant) => (
              <TableRow
                className="cursor-pointer"
                key={tenant.id}
                onClick={() =>
                  navigate({
                    to: "/tenants/$slug",
                    params: { slug: tenant.slug },
                  })
                }
              >
                <TableCell className="font-medium">{tenant.slug}</TableCell>
                <TableCell>{tenant.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      tenant.status === "active" ? "default" : "secondary"
                    }
                  >
                    {tenant.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(tenant.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {tenants.data ? (
        <Pagination
          onPageChange={setPage}
          page={page}
          pageSize={tenantListPageSize}
          total={tenants.data.meta.total}
        />
      ) : null}
    </div>
  );
}
