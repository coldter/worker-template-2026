ALTER TABLE "roles" DROP CONSTRAINT "roles_name_key";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_slug_key";--> statement-breakpoint
DROP INDEX "roles_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" ("name") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_slug_unique" ON "roles" ("slug") WHERE "deleted_at" is null;