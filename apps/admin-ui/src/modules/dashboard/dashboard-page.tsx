import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { tenantListQueryOptions } from "@/modules/tenants/query";
import { Button } from "@/modules/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/ui/card";

export function DashboardPage() {
  const tenants = useQuery(tenantListQueryOptions({ page: 1 }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-2xl">Dashboard</h2>
        <p className="text-muted-foreground text-sm">
          Operator console overview.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-bold text-3xl">
              {tenants.isLoading ? "—" : (tenants.data?.meta.total ?? 0)}
            </p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link to="/tenants">View tenants</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Global admins</CardTitle>
          </CardHeader>
          <CardContent>
            {/* TODO(api-gen): wire to operator count endpoint when available */}
            <p className="font-bold text-3xl">—</p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link to="/global-admins">View global admins</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Cross-tenant operator activity.
            </p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link to="/audit-logs">View audit logs</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
