import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useOperator } from "@/modules/operator/provider";
import { Button } from "@/modules/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/ui/card";
import { Input } from "@/modules/ui/input";
import { Label } from "@/modules/ui/label";
import { useCreateTenant } from "./query";

export function NewTenantPage() {
  const navigate = useNavigate();
  const { can } = useOperator();
  const create = useCreateTenant();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [primaryAdminEmail, setPrimaryAdminEmail] = useState("");

  if (!can("tenant.create")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forbidden</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Your role does not permit creating tenants.
          </p>
        </CardContent>
      </Card>
    );
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      { slug, name, primaryAdminEmail },
      {
        onSuccess: () => {
          toast.success("Tenant created");
          navigate({ to: "/tenants" });
        },
      }
    );
  };

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create tenant</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="acme"
                required
                value={slug}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme, Inc."
                required
                value={name}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Primary admin email</Label>
              <Input
                id="email"
                onChange={(e) => setPrimaryAdminEmail(e.target.value)}
                placeholder="owner@acme.com"
                required
                type="email"
                value={primaryAdminEmail}
              />
            </div>
            <div className="flex gap-2">
              <Button disabled={create.isPending} type="submit">
                {create.isPending ? "Creating…" : "Create"}
              </Button>
              <Button
                onClick={() => navigate({ to: "/tenants" })}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
