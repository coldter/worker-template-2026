import { firstOrNull, liveOrganizations } from "@repo/db";
import { organizations } from "@repo/db/schema";
import type { Tenant } from "@repo/tenancy";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
import type { TenancyCurrentResponse } from "./schema";

type BrandingShape = {
  logoUrl?: string;
  primaryColor?: string;
  appName?: string;
  logoVersion?: number;
  logoExt?: string;
};

function buildLogoUrl(
  baseUrl: string | undefined,
  slug: string,
  branding: BrandingShape
): string | null {
  if (branding.logoUrl) {
    return branding.logoUrl;
  }
  if (!baseUrl || branding.logoVersion === undefined) {
    return null;
  }
  const ext = branding.logoExt ?? "png";
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/${slug}/${branding.logoVersion}.${ext}`;
}

export async function tenancyCurrentHandler(
  c: Context<AppEnv>
): Promise<Response> {
  const tenant: Tenant | null = c.var.tenant;
  if (!tenant) {
    return c.json(
      {
        error: { code: "NOT_FOUND", message: "Tenant not resolved" },
      },
      404
    );
  }
  // Pull the row so we can return name + branding even though tenancy
  // resolution only carries the minimal multi-tenancy fields.
  const row = await firstOrNull(
    liveOrganizations(c.var.db).selectById(
      {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        enforceSSO: organizations.enforceSSO,
        branding: organizations.branding,
      },
      tenant.organizationId
    )
  );
  if (!row) {
    return c.json(
      {
        error: { code: "NOT_FOUND", message: "Tenant organization missing" },
      },
      404
    );
  }
  const branding: BrandingShape = row.branding ?? {};
  const slug = tenant.slug ?? row.slug ?? "";
  const baseUrl = c.env.BRANDING_BASE_URL ?? undefined;
  const response: TenancyCurrentResponse = {
    id: row.id,
    slug,
    host: tenant.host,
    name: row.name,
    enforceSso: row.enforceSSO,
    branding: {
      primaryColor: branding.primaryColor ?? null,
      logoUrl: buildLogoUrl(baseUrl, slug, branding),
      appName: branding.appName ?? null,
      logoVersion: branding.logoVersion ?? null,
    },
  };
  return c.json(response, 200);
}
