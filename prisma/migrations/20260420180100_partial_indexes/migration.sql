-- Partial indexes (raw SQL — can't be expressed in prisma/schema.prisma).
-- See prisma/migrations-plan.md §6 for rationale.

-- Users: unique email across non-deleted rows only.
-- (Replaces the unconditional users_email_key created in 20260420180000_schema_v2.)
DROP INDEX IF EXISTS "users_email_key";
CREATE UNIQUE INDEX "users_email_active_key"
  ON "users" ("email")
  WHERE "deleted_at" IS NULL;

-- Resume library: user's resumes newest first (active only).
CREATE INDEX "resumes_user_updated_active_idx"
  ON "resumes" ("user_id", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;

-- JD library: same pattern.
CREATE INDEX "job_descriptions_user_updated_active_idx"
  ON "job_descriptions" ("user_id", "updated_at" DESC)
  WHERE "deleted_at" IS NULL;

-- Session history: user's sessions newest first, excluding soft-deleted.
CREATE INDEX "interview_sessions_user_created_active_idx"
  ON "interview_sessions" ("user_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

-- Report cards: "current card for this session" lookup.
CREATE INDEX "report_cards_session_current_idx"
  ON "report_cards" ("session_id")
  WHERE "is_current" = true;

-- Share links: live (non-revoked) token lookup.
-- (Expiry intentionally NOT in the predicate — now() is STABLE, not IMMUTABLE;
--  callers filter expires_at at query time.)
CREATE INDEX "report_share_links_token_active_idx"
  ON "report_share_links" ("token")
  WHERE "revoked_at" IS NULL;

-- LLM observability: triage failures by purpose, newest first.
CREATE INDEX "llm_calls_purpose_failed_idx"
  ON "llm_calls" ("purpose", "created_at" DESC)
  WHERE "succeeded" = false;
