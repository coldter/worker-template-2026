import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useOperator } from "@/modules/operator/provider";
import { Badge } from "@/modules/ui/badge";
import { Button } from "@/modules/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/ui/card";
import { Input } from "@/modules/ui/input";
import { Label } from "@/modules/ui/label";
import {
  tenantDetailQueryOptions,
  useDeleteTenant,
  useRestoreTenant,
  useSuspendTenant,
} from "./query";

interface TenantDetailPageProps {
  slug: string;
}

export function TenantDetailPage({ slug }: TenantDetailPageProps) {
  const navigate = useNavigate();
  const { can } = useOperator();
  const tenant = useQuery(tenantDetailQueryOptions(slug));
  const suspend = useSuspendTenant();
  const restore = useRestoreTenant();
  const remove = useDeleteTenant();
  const [reason, setReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (tenant.isLoading) {
    return <p>Loading…</p>;
  }

  if (tenant.error) {
    const status =
      tenant.error instanceof ApiError ? tenant.error.status : undefined;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tenant unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {/* TODO(api-gen): admin worker has no GET /tenants/:slug yet (B2 stub). */}
            Detail endpoint not implemented yet
            {status ? ` (HTTP ${status})` : ""}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const data = tenant.data;
  if (!data) {
    return null;
  }
  const id = data.id;

  const onSuspend = () => {
    suspend.mutate(
      { organizationId: id, reason: reason || undefined },
      { onSuccess: () => toast.success("Tenant suspended") }
    );
  };

  const onRestore = () => {
    restore.mutate(
      { organizationId: id },
      { onSuccess: () => toast.success("Tenant restored") }
    );
  };

  const onDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    remove.mutate(
      { organizationId: id, reason: reason || undefined },
      {
        onSuccess: () => {
          toast.success("Tenant deleted");
          navigate({ to: "/tenants" });
        },
        onSettled: () => setConfirmingDelete(false),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-2xl">{data.name}</h2>
        <p className="text-muted-foreground text-sm">{data.slug}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tenant details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase">
                Status
              </dt>
              <dd className="mt-1">
                <Badge
                  variant={data.status === "active" ? "default" : "secondary"}
                >
                  {data.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">ID</dt>
              <dd className="mt-1 font-mono text-sm">{data.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">
                Created
              </dt>
              <dd className="mt-1 text-sm">{formatDate(data.createdAt)}</dd>
            </div>
            {data.suspendedAt ? (
              <div>
                <dt className="text-muted-foreground text-xs uppercase">
                  Suspended
                </dt>
                <dd className="mt-1 text-sm">{formatDate(data.suspendedAt)}</dd>
              </div>
            ) : null}
            {data.primaryAdminEmail ? (
              <div>
                <dt className="text-muted-foreground text-xs uppercase">
                  Primary admin
                </dt>
                <dd className="mt-1 text-sm">{data.primaryAdminEmail}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reason">Reason (audited)</Label>
            <Input
              id="reason"
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional reason for the action"
              value={reason}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {can("tenant.suspend") ? (
              <Button
                disabled={data.status !== "active" || suspend.isPending}
                onClick={onSuspend}
                type="button"
                variant="outline"
              >
                Suspend
              </Button>
            ) : null}
            {can("tenant.restore") ? (
              <Button
                disabled={data.status === "active" || restore.isPending}
                onClick={onRestore}
                type="button"
                variant="outline"
              >
                Restore
              </Button>
            ) : null}
            {can("tenant.delete") ? (
              <Button
                disabled={remove.isPending}
                onClick={onDelete}
                type="button"
                variant="destructive"
              >
                {confirmingDelete ? "Confirm delete" : "Delete"}
              </Button>
            ) : null}
            {confirmingDelete ? (
              <Button
                onClick={() => setConfirmingDelete(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
