import { Link, Outlet } from "@tanstack/react-router";
import { brand } from "@/lib/brand";
import { useOperator } from "@/modules/operator/provider";
import { Badge } from "@/modules/ui/badge";
import { Separator } from "@/modules/ui/separator";

interface NavItem {
  label: string;
  to: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/tenants", label: "Tenants" },
  { to: "/audit-logs", label: "Audit logs" },
  { to: "/global-admins", label: "Global admins" },
  { to: "/system", label: "System" },
];

export function OperatorLayout() {
  const { operator } = useOperator();

  return (
    <div className="grid min-h-svh grid-cols-[16rem_1fr]">
      <aside className="flex flex-col border-r bg-sidebar p-4">
        <Link className="mb-6 font-semibold text-lg" to="/">
          {brand.appName}
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                "aria-current": "page",
                className: "bg-primary text-primary-foreground",
              }}
              className="rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              key={item.to}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center gap-3 border-b px-6">
          <h1 className="font-medium text-base">Operator console</h1>
          <Separator className="h-6" orientation="vertical" />
          <div className="ms-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{operator.email}</span>
            <Badge variant="outline">{operator.role}</Badge>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
