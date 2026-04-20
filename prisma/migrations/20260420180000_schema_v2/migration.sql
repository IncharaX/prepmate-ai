-- Schema v2 — full rewrite to the production design.
-- See prisma/migrations-plan.md and docs/AUDIT.md for context.
--
-- Users exported to backups/users-pre-schema-v2-*.json before this migration.
-- A re-import script (prisma/migrations/20260420180000_schema_v2/reimport-users.ts)
-- runs after the migration to re-create the user rows with new UUIDs.
--
-- Legacy interview data (InterviewSession + InterviewResult, old summary blobs)
-- is intentionally dropped per migrations-plan.md §3 — the new schema is not
-- structurally compatible.

BEGIN;

-- =====================================================
-- 1. Drop old FKs
-- =====================================================
ALTER TABLE "InterviewResult" DROP CONSTRAINT IF EXISTS "InterviewResult_sessionId_fkey";
ALTER TABLE "InterviewSession" DROP CONSTRAINT IF EXISTS "InterviewSession_userId_fkey";

-- =====================================================
-- 2. Drop old tables
-- =====================================================
DROP TABLE IF EXISTS "InterviewResult";
DROP TABLE IF EXISTS "InterviewSession";
DROP TABLE IF EXISTS "User";

-- =====================================================
-- 3. Drop old enums
-- =====================================================
DROP TYPE IF EXISTS "InterviewMode";
DROP TYPE IF EXISTS "InterviewStatus";

-- =====================================================
-- 4. Create new enums
-- =====================================================
CREATE TYPE "InterviewMode" AS ENUM ('text', 'voice');
CREATE TYPE "InterviewType" AS ENUM ('hr_screen', 'behavioral', 'technical_screen', 'mixed');
CREATE TYPE "InterviewDifficulty" AS ENUM ('entry', 'mid', 'senior');
CREATE TYPE "SessionStatus" AS ENUM ('pending', 'ready', 'in_progress', 'completed', 'completed_partial', 'failed', 'abandoned');
CREATE TYPE "SpeakerRole" AS ENUM ('interviewer', 'candidate');
CREATE TYPE "Recommendation" AS ENUM ('strong_yes', 'yes', 'maybe', 'no', 'strong_no');
CREATE TYPE "FitStatus" AS ENUM ('met', 'partial', 'unclear', 'not_shown');
CREATE TYPE "LlmPurpose" AS ENUM ('resume_parse', 'jd_parse', 'interview_prep', 'evaluation', 'question_evaluation', 'jd_fit_analysis', 'other');

-- =====================================================
-- 5. Create new tables
-- =====================================================

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "file_url" TEXT,
    "file_name" TEXT,
    "file_size_bytes" INTEGER,
    "extracted_text" TEXT NOT NULL,
    "parsed_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_descriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "company_name" TEXT,
    "role_title" TEXT,
    "raw_text" TEXT NOT NULL,
    "parsed_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "job_descriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interview_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resume_id" UUID NOT NULL,
    "job_description_id" UUID NOT NULL,
    "question_count" INTEGER NOT NULL,
    "interview_type" "InterviewType" NOT NULL DEFAULT 'hr_screen',
    "difficulty" "InterviewDifficulty" NOT NULL DEFAULT 'mid',
    "mode" "InterviewMode" NOT NULL DEFAULT 'voice',
    "prep_data" JSONB,
    "prep_model" TEXT,
    "prep_completed_at" TIMESTAMP(3),
    "elevenlabs_agent_id" TEXT,
    "elevenlabs_conversation_id" TEXT,
    "call_started_at" TIMESTAMP(3),
    "call_ended_at" TIMESTAMP(3),
    "call_duration_seconds" INTEGER,
    "full_audio_url" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "interview_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transcript_turns" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "speaker" "SpeakerRole" NOT NULL,
    "content" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "audio_url" TEXT,
    "word_timestamps" JSONB,
    "stt_confidence" DOUBLE PRECISION,
    "question_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcript_turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_cards" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "rubric_version" TEXT NOT NULL,
    "evaluator_model" TEXT NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "recommendation_reason" TEXT NOT NULL,
    "score_communication" INTEGER NOT NULL,
    "score_jd_relevance" INTEGER NOT NULL,
    "score_experience_depth" INTEGER NOT NULL,
    "score_specificity" INTEGER NOT NULL,
    "score_confidence" INTEGER NOT NULL,
    "strengths" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "raw_llm_response" JSONB,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "question_evaluations" (
    "id" UUID NOT NULL,
    "report_card_id" UUID NOT NULL,
    "question_index" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_summary" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "what_worked" TEXT,
    "what_to_improve" TEXT,
    "transcript_quote" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jd_fit_items" (
    "id" UUID NOT NULL,
    "report_card_id" UUID NOT NULL,
    "turn_id" UUID,
    "requirement" TEXT NOT NULL,
    "is_must_have" BOOLEAN NOT NULL,
    "status" "FitStatus" NOT NULL,
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jd_fit_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_share_links" (
    "id" UUID NOT NULL,
    "report_card_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "report_share_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "user_id" UUID,
    "purpose" "LlmPurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "prompt" JSONB NOT NULL,
    "response" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "latency_ms" INTEGER,
    "succeeded" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- =====================================================
-- 6. Indexes
-- =====================================================

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "resumes_user_id_idx" ON "resumes"("user_id");
CREATE INDEX "job_descriptions_user_id_idx" ON "job_descriptions"("user_id");
CREATE INDEX "interview_sessions_user_id_created_at_idx" ON "interview_sessions"("user_id", "created_at" DESC);
CREATE INDEX "interview_sessions_status_idx" ON "interview_sessions"("status");
CREATE INDEX "interview_sessions_elevenlabs_conversation_id_idx" ON "interview_sessions"("elevenlabs_conversation_id");
CREATE UNIQUE INDEX "transcript_turns_session_id_turn_index_key" ON "transcript_turns"("session_id", "turn_index");
CREATE INDEX "transcript_turns_session_id_question_index_idx" ON "transcript_turns"("session_id", "question_index");
CREATE INDEX "report_cards_session_id_idx" ON "report_cards"("session_id");
CREATE UNIQUE INDEX "question_evaluations_report_card_id_question_index_key" ON "question_evaluations"("report_card_id", "question_index");
CREATE INDEX "jd_fit_items_report_card_id_idx" ON "jd_fit_items"("report_card_id");
CREATE UNIQUE INDEX "report_share_links_token_key" ON "report_share_links"("token");
CREATE INDEX "report_share_links_report_card_id_idx" ON "report_share_links"("report_card_id");
CREATE INDEX "llm_calls_session_id_idx" ON "llm_calls"("session_id");
CREATE INDEX "llm_calls_user_id_created_at_idx" ON "llm_calls"("user_id", "created_at" DESC);
CREATE INDEX "llm_calls_purpose_created_at_idx" ON "llm_calls"("purpose", "created_at" DESC);

-- =====================================================
-- 7. Foreign keys
-- =====================================================

ALTER TABLE "auth_sessions"        ADD CONSTRAINT "auth_sessions_user_id_fkey"             FOREIGN KEY ("user_id")            REFERENCES "users"("id")              ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "resumes"              ADD CONSTRAINT "resumes_user_id_fkey"                   FOREIGN KEY ("user_id")            REFERENCES "users"("id")              ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "job_descriptions"     ADD CONSTRAINT "job_descriptions_user_id_fkey"          FOREIGN KEY ("user_id")            REFERENCES "users"("id")              ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "interview_sessions"   ADD CONSTRAINT "interview_sessions_user_id_fkey"        FOREIGN KEY ("user_id")            REFERENCES "users"("id")              ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "interview_sessions"   ADD CONSTRAINT "interview_sessions_resume_id_fkey"      FOREIGN KEY ("resume_id")          REFERENCES "resumes"("id")            ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_sessions"   ADD CONSTRAINT "interview_sessions_job_description_id_fkey" FOREIGN KEY ("job_description_id") REFERENCES "job_descriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transcript_turns"     ADD CONSTRAINT "transcript_turns_session_id_fkey"       FOREIGN KEY ("session_id")         REFERENCES "interview_sessions"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "report_cards"         ADD CONSTRAINT "report_cards_session_id_fkey"           FOREIGN KEY ("session_id")         REFERENCES "interview_sessions"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "question_evaluations" ADD CONSTRAINT "question_evaluations_report_card_id_fkey" FOREIGN KEY ("report_card_id")   REFERENCES "report_cards"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "jd_fit_items"         ADD CONSTRAINT "jd_fit_items_report_card_id_fkey"       FOREIGN KEY ("report_card_id")     REFERENCES "report_cards"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "jd_fit_items"         ADD CONSTRAINT "jd_fit_items_turn_id_fkey"              FOREIGN KEY ("turn_id")            REFERENCES "transcript_turns"("id")   ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_share_links"   ADD CONSTRAINT "report_share_links_report_card_id_fkey" FOREIGN KEY ("report_card_id")     REFERENCES "report_cards"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "llm_calls"            ADD CONSTRAINT "llm_calls_session_id_fkey"              FOREIGN KEY ("session_id")         REFERENCES "interview_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "llm_calls"            ADD CONSTRAINT "llm_calls_user_id_fkey"                 FOREIGN KEY ("user_id")            REFERENCES "users"("id")              ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
