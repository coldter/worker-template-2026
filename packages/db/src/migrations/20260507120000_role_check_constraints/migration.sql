-- Restrict member.role and invitation.role to the canonical org-role
-- vocabulary. Without these CHECK constraints a malformed insert (or a
-- bypassed validator at the application layer) could land an unexpected
-- role string and silently grant or deny access at the policy layer.
-- The drizzle schema for these tables is owned by Wave 1; the constraint
-- is added here as a hand-written DDL migration so the snapshot.json does
-- not need regeneration in this wave (caller will re-run `bun run db:generate`
-- before merge to materialize the constraint into the snapshot).

ALTER TABLE "member"
  ADD CONSTRAINT "member_role_check"
  CHECK ("role" IN ('owner', 'admin', 'member'));
--> statement-breakpoint
ALTER TABLE "invitation"
  ADD CONSTRAINT "invitation_role_check"
  CHECK ("role" IN ('owner', 'admin', 'member'));
