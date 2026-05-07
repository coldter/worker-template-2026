import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/operator/provider", () => ({
  useOperator: () => ({
    operator: {
      id: "op_test",
      email: "operator@example.com",
      role: "super_admin",
      status: "active",
    },
    can: () => true,
  }),
  OperatorProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { AuditLogsPage } from "@/modules/audit-logs/audit-logs-page";
import { DashboardPage } from "@/modules/dashboard/dashboard-page";
import { GlobalAdminsPage } from "@/modules/global-admins/global-admins-page";
import { OperatorLayout } from "@/modules/layout/operator-layout";
import { SystemPage } from "@/modules/system/system-page";
import { NewTenantPage } from "@/modules/tenants/new-tenant-page";
import { TenantDetailPage } from "@/modules/tenants/tenant-detail-page";
import { TenantsListPage } from "@/modules/tenants/tenants-list-page";
import { render } from "./test-utils";

const fetchMock = vi.fn();
const LOADING_RE = /Loading/;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator console smoke", () => {
  it("renders the operator layout shell", () => {
    const { container } = render(<OperatorLayout />);
    expect(container.querySelector("aside")).not.toBeNull();
  });

  it("renders the dashboard", () => {
    const { getByText } = render(<DashboardPage />);
    expect(getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders the tenants list", () => {
    const { getByText } = render(
      <TenantsListPage page={1} setPage={() => undefined} />
    );
    expect(getByText("Tenants")).toBeInTheDocument();
  });

  it("renders the create-tenant form", () => {
    const { getByText } = render(<NewTenantPage />);
    expect(getByText("Create tenant")).toBeInTheDocument();
  });

  it("renders the tenant detail loading state", () => {
    const { getByText } = render(<TenantDetailPage slug="acme" />);
    expect(getByText(LOADING_RE)).toBeInTheDocument();
  });

  it("renders the audit logs page", () => {
    const { getByText } = render(
      <AuditLogsPage onChange={() => undefined} page={1} />
    );
    expect(getByText("Audit logs")).toBeInTheDocument();
  });

  it("renders the global admins page", () => {
    const { getByText } = render(
      <GlobalAdminsPage page={1} setPage={() => undefined} />
    );
    expect(getByText("Global admins")).toBeInTheDocument();
  });

  it("renders the system placeholder", () => {
    const { getByText } = render(<SystemPage />);
    expect(getByText("System")).toBeInTheDocument();
  });
});
