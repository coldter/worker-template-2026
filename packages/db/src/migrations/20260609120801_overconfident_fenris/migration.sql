CREATE INDEX "users_created_at_idx" ON "users" ("created_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" ("status");--> statement-breakpoint
CREATE INDEX "users_role_slugs_idx" ON "users" USING gin ("role_slugs");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id") WHERE channel = 'push' and read_at is null and status in ('sent', 'delivered');