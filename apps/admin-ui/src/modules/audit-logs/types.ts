/**
 * Cross-tenant audit log row projected by the admin audit-logs handler.
 * TODO(api-gen): replace with the generated OpenAPI type once the admin
 * worker's `openapi.cache.json` exists.
 */
export interface AdminAuditLog {
  actorEmail?: string | null;
  actorId?: string | null;
  event: string;
  id: string;
  occurredAt: string;
  organizationId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
}

export interface AdminAuditLogListResponse {
  data: AdminAuditLog[];
  meta: { total: number };
}
