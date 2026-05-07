ALTER TABLE "auth_relations" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "suspended_at" SET DATA TYPE timestamp with time zone USING "suspended_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone USING "deleted_at"::timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_logs_org_event_created_at_idx" ON "audit_logs" ("organization_id","event","created_at" DESC NULLS LAST);