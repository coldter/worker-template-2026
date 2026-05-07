-- Enable pgcrypto for symmetric encryption of OIDC config blobs (D13, D73).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "global_admins" (
	"id" varchar(255) PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"cf_access_sub" text UNIQUE,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"enrollment_token" text UNIQUE,
	"enrollment_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"last_active_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" varchar(255),
	"deactivated_reason" text
);
--> statement-breakpoint
CREATE TABLE "reserved_slugs" (
	"id" varchar(255) PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"kind" text DEFAULT 'slug' NOT NULL,
	"reason" text NOT NULL,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" varchar(255) PRIMARY KEY,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"oidc_config" text,
	"oidc_config_encrypted" bytea,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL UNIQUE,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_custom_hostnames" (
	"id" varchar(255) PRIMARY KEY,
	"organization_id" text NOT NULL,
	"hostname" text NOT NULL UNIQUE,
	"cf_hostname_id" text UNIQUE,
	"lifecycle_status" text DEFAULT 'pending_txt' NOT NULL,
	"cf_status" text,
	"cf_ssl_status" text,
	"verification_errors" jsonb DEFAULT '[]' NOT NULL,
	"verification_token" text NOT NULL,
	"verification_verified_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"last_cf_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "organization_id" varchar(255);--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "enforce_sso" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_by" varchar(255);--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deleted_by" varchar(255);--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "branding" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "inviter_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_type_created_at_idx" ON "audit_logs" ("actor_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_org_id_created_at_idx" ON "audit_logs" ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "global_admins_active_email_idx" ON "global_admins" ("email") WHERE "deactivated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "global_admins_role_idx" ON "global_admins" ("role");--> statement-breakpoint
CREATE INDEX "ssop_org_id_idx" ON "sso_providers" ("organization_id");--> statement-breakpoint
CREATE INDEX "ssop_domain_idx" ON "sso_providers" ("domain");--> statement-breakpoint
CREATE INDEX "tch_organization_id_idx" ON "tenant_custom_hostnames" ("organization_id");--> statement-breakpoint
CREATE INDEX "tch_status_reconciled_idx" ON "tenant_custom_hostnames" ("lifecycle_status","last_reconciled_at");--> statement-breakpoint
ALTER TABLE "global_admins" ADD CONSTRAINT "global_admins_created_by_global_admins_id_fkey" FOREIGN KEY ("created_by") REFERENCES "global_admins"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "global_admins" ADD CONSTRAINT "global_admins_deactivated_by_global_admins_id_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "global_admins"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reserved_slugs" ADD CONSTRAINT "reserved_slugs_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_custom_hostnames" ADD CONSTRAINT "tenant_custom_hostnames_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
-- The decrypted view aliases pgp_sym_decrypt(oidc_config_encrypted, app.sso_key)
-- back to oidc_config so Better Auth's raw plugin reads work transparently.
-- The CASE fallback to plaintext oidc_config exists ONLY for un-migrated rows.
-- current_setting('app.sso_key') raises if the GUC is unset — fail-closed by design.
-- This view is SECURITY INVOKER (default); do not flip to SECURITY DEFINER.
CREATE OR REPLACE VIEW sso_providers_decrypted AS
  SELECT
    id,
    issuer,
    domain,
    domain_verified,
    CASE
      WHEN oidc_config_encrypted IS NULL THEN oidc_config
      ELSE pgp_sym_decrypt(oidc_config_encrypted, current_setting('app.sso_key'))::text
    END AS oidc_config,
    saml_config,
    user_id,
    provider_id,
    organization_id,
    created_at,
    updated_at
  FROM sso_providers;
--> statement-breakpoint
-- audit_logs is append-only. UPDATE and DELETE are forbidden at the DB level.
-- Defense-in-depth backstop for D16/D37: even if the app role is misconfigured,
-- the trigger prevents silent data mutation.
CREATE OR REPLACE FUNCTION audit_logs_no_mutation_fn() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_mutation_trigger ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_mutation_trigger
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutation_fn();