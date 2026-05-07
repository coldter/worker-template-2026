export type Tenant = Readonly<{
  organizationId: string;
  slug: string | null;
  host: string;
  kind: "subdomain" | "custom";
  enforceSSO: boolean;
  sessionVersion: number;
  suspendedAt: Date | null;
  deletedAt: Date | null;
}>;

export type TenantNotFound = Readonly<{ kind: "not_found"; host: string }>;
export type TenantSuspended = Readonly<{ kind: "suspended"; tenant: Tenant }>;

export type TenantResolution = Tenant | TenantNotFound | TenantSuspended;
