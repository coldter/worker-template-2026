ALTER TABLE "auth_relations" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_relations" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
CREATE INDEX "auth_rel_created_by_idx" ON "auth_relations" ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_org_unique" ON "member" ("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deactivated_by_users_id_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "auth_relations" ADD CONSTRAINT "auth_relations_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_type_check" CHECK ("actor_type" in ('user', 'system', 'api'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_type_check" CHECK ("target_type" is null or "target_type" in ('user', 'role', 'session'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_platform_check" CHECK ("platform" in ('web', 'mobile'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" in ('active', 'inactive', 'locked', 'deleted'));