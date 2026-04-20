# PrepMate AI — Prisma Migration Plan

_Read before any migration runs. Updates to this file must be PR-reviewed; the schema migrations implement exactly what's here._

## 0. Prerequisites (must fix BEFORE the first migration)

### 0.1 Generator provider

The target schema uses `provider = "prisma-client-js"` in the generator block. **That's Prisma 5/6 syntax and will break our build on Prisma 7**. `package.json` pins `prisma ^7.7.0` and `@prisma/client ^7.7.0`. The client is consumed via `lib/prisma.ts` importing from `./generated/prisma/client`. Required fix in the target schema:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../lib/generated/prisma"
}
```

Confirm before we touch anything else.

### 0.2 `datasource db.url`

The target schema adds `url = env("DATABASE_URL")` to the datasource block — the current schema omits `url` because the Prisma adapter reads it from `lib/prisma.ts`. Either form works; I'll keep the explicit `url` line from the target (matches Prisma docs, no functional impact).

### 0.3 `InterviewSession.mode`

The target schema drops the `mode` field. Today we branch text-vs-voice rendering on `session.mode` (`app/interview/[id]/page.tsx:75`). Decision required before we commit:

- **Option A — Keep it.** Add `mode InterviewMode @default(voice)` (or similar enum) to `interview_sessions`.
- **Option B — Derive it.** `voice if elevenlabs_conversation_id IS NOT NULL else text`. Implicit state — risky.
- **Option C — Drop text mode entirely.** Voice-only product going forward; `/interview/[id]/InterviewRoom.tsx` deleted.

Recommend A or C. Do not ship B.

### 0.4 `Resume` uploads

The target's `Resume` model requires `fileUrl`, `fileName`, `fileSizeBytes`. We have no file storage wired. Decision required:

- **Option A — Make all three nullable** in the target schema. `extractedText` is the only required field. We wire uploads later.
- **Option B — Commit blob storage now** (Vercel Blob / R2 / S3). Adds scope.

Recommend A until uploads are a real feature. Document in the schema that legacy resumes have empty `fileUrl/fileName`.

### 0.5 Legacy `summary` handling

The legacy `summary` Json has fields that don't map cleanly to `ReportCard` (see §2). Decision required:

- **Option A — Drop.** Legacy sessions end up with no `ReportCard`. Detail page renders a "legacy session, transcript only" state.
- **Option B — Synthesize.** Create a `ReportCard` with fake values for unmapped fields (0 for score_jd_relevance / score_experience_depth / score_specificity, `maybe` for recommendation).

Recommend A. B produces misleading data.

### 0.6 Auth strategy flip

Populating `AuthSession` and switching Auth.js from JWT → database strategy will invalidate every outstanding JWT. Decision required:

- **Option A — Invalidate on switchover.** Users re-log-in once. Cleanest.
- **Option B — Dual-strategy grace period.** Keep JWT valid for N days while issuing DB sessions. More code.

Recommend A.

---

## 1. Table mapping: current → target

| Current model / table | Target model / table | Relationship |
| --- | --- | --- |
| `User` | `User` → `users` | 1:1 rename + additions |
| (none) | `AuthSession` → `auth_sessions` | NEW (currently JWT, no DB) |
| (none) | `Resume` → `resumes` | NEW (factor out of `InterviewSession.resume`) |
| (none) | `JobDescription` → `job_descriptions` | NEW (factor out of `InterviewSession.resumeText`) |
| `InterviewSession` | `InterviewSession` → `interview_sessions` | heavy restructure |
| `InterviewResult` | `TranscriptTurn` → `transcript_turns` | split: one result → two turns |
| (field `InterviewSession.summary` Json) | `ReportCard` → `report_cards` | blob → structured table |
| (none) | `QuestionEvaluation` → `question_evaluations` | NEW |
| (none) | `JdFitItem` → `jd_fit_items` | NEW |
| (none) | `ReportShareLink` → `report_share_links` | NEW |
| (none) | `LlmCall` → `llm_calls` | NEW observability |

---

## 2. Column-level changes

### `User` → `users`

| Old | New | Op |
| --- | --- | --- |
| `id String @id @default(cuid())` | `id String @id @default(uuid()) @db.Uuid` | TYPE CHANGE (cuid → uuid). Backfill via lookup. |
| `email String @unique` | same | no change |
| `passwordHash String @default("")` | `passwordHash String @map("password_hash")` | drop default `""` (footgun). Legacy rows with `""` flagged `email_verified=false` and forced to reset. |
| `name String` | `name String?` | becomes nullable |
| (none) | `emailVerified Boolean @default(false) @map("email_verified")` | NEW |
| `createdAt DateTime @default(now())` | same with `@map("created_at")` | rename at DB level only |
| (none) | `updatedAt DateTime @updatedAt @map("updated_at")` | NEW |
| (none) | `deletedAt DateTime? @map("deleted_at")` | NEW (soft delete) |

### `InterviewSession` → `interview_sessions`

**Drop**:
- `title` (moves conceptually to `Resume.label` and `JobDescription.label`)
- `domain` (was always `"JD-based Interview"` — meaningless)
- `resumeText` (moves to `JobDescription.rawText` via synthesis)
- `resume` (moves to `Resume.extractedText` via synthesis)
- `summary` Json (migrates to `ReportCard` — see §3)
- `mode` (pending §0.3 decision)

**Rename (via @map)**:
- `plannedQuestions` → `question_count`
- `elevenLabsConvId` → `elevenlabs_conversation_id`
- `createdAt` → `created_at`
- `completedAt` — NOT equivalent to `callEndedAt`. Map to `callEndedAt` only if we know the session ended via a completed call; else drop.

**New required FKs** (not nullable in target):
- `resumeId String @db.Uuid` → `Resume`
- `jobDescriptionId String @db.Uuid` → `JobDescription`

Backfill requires synthesizing one `Resume` and one `JobDescription` per existing session (see §4 Migration 5).

**New optional fields**:
- `interviewType InterviewType @default(hr_screen)` — default for legacy rows
- `difficulty InterviewDifficulty @default(mid)` — default for legacy rows
- `prepData Json?`, `prepModel String?`, `prepCompletedAt DateTime?` — null for legacy
- `elevenlabsAgentId String?` — we only have one agent today; null for legacy
- `callStartedAt/EndedAt DateTime?`, `callDurationSeconds Int?`, `fullAudioUrl String?` — null for legacy
- `errorMessage String?` — null for legacy
- `updatedAt DateTime @updatedAt`, `deletedAt DateTime?` — NEW

**Enum change**: `InterviewStatus` → `SessionStatus`
- Old: `IN_PROGRESS`, `COMPLETED`, `ABANDONED`
- New: `pending`, `ready`, `in_progress`, `completed`, `completed_partial`, `failed`, `abandoned`
- Mapping: `IN_PROGRESS → in_progress`, `COMPLETED → completed`, `ABANDONED → abandoned`. No legacy row maps to `pending/ready/completed_partial/failed`.

### `InterviewResult` → `transcript_turns`

**Structural change**: one `InterviewResult` row (question + answer) becomes **two** `TranscriptTurn` rows.

| Old column | Mapping |
| --- | --- |
| `id String` (cuid) | replaced by new UUIDs (two per old row) |
| `sessionId` | `session_id` — requires the session's new UUID |
| `order Int` | derives `turn_index`: interviewer at `2*order`, candidate at `2*order+1` |
| `question String` | `content` on the `interviewer` turn |
| `answer String` | `content` on the `candidate` turn |
| `contentScore`, `communicationScore`, `confidenceScore`, `feedback` | **NOT preserved on turns** — don't fit the turn schema. See §3. |

**New required fields** on `TranscriptTurn`: `start_ms Int`, `end_ms Int`. Legacy rows have no timings. Backfill both to `0`. Documented in data.

Nullable on backfilled rows: `audioUrl`, `wordTimestamps`, `sttConfidence`, `questionIndex`.

### `InterviewSession.summary` Json → `ReportCard`

Fields that can be translated:

| Old `summary.*` | New `report_cards.*` |
| --- | --- |
| `summary` (string) | `summary` |
| `overallScore` | `overall_score` |
| `strengths` (array of strings) | `strengths` Json — wrap each as `{ title, detail, transcript_quote: null, turn_id: null }` |
| `improvements` (array of strings) | `gaps` Json — same wrapping |
| `partial: true` | session `status = completed_partial` |

Fields that **do not** translate:
- `recommendation` enum — no legacy equivalent
- Five new score dimensions — old has only content / communication / confidence
- `rubricVersion`, `evaluatorModel` — no legacy values

**Per §0.5 decision: don't synthesize ReportCards for legacy sessions.** Legacy sessions end at `status = completed` with no linked `ReportCard`. UI handles the missing-card case.

---

## 3. Data preservation policy

| Data class | Policy | Rationale |
| --- | --- | --- |
| User rows (id, email, passwordHash, name, createdAt) | **Preserve** with new UUIDs | Users shouldn't re-sign-up. |
| `passwordHash = ""` users | **Force password reset.** `email_verified = false`, next login triggers the reset flow. | Empty hashes are a security footgun. |
| AuthSessions | **Not applicable** | Current strategy is JWT — no rows to migrate. Sessions issued fresh after switchover (§0.6). |
| `InterviewSession` rows | **Preserve with synthesis** | Users see their history. Synthesize one `Resume` + one `JobDescription` per session from existing fields. |
| `InterviewResult` rows | **Preserve as `TranscriptTurn` pairs** | Users can re-read their transcripts. Scores are not translated. |
| Per-answer scores + feedback | **Drop** | Old rubric is 3-dimensional; new is 5-dimensional. Translating is worse than a clean reset. |
| `InterviewSession.summary` Json | **Drop (no ReportCards synthesized)** | Per §0.5. |
| `elevenlabsConversationId` | **Preserve** | Still useful for auditing. |

**Pre-migration backup**: before Migration 1 runs, `pg_dump $DIRECT_DATABASE_URL > backups/pre-schema-v2-$(date +%Y%m%d-%H%M).sql`. Keep for 90 days. Not committed to git.

---

## 4. Migration order (split into cleanly separate steps)

Each step is a separate `prisma migrate dev --name=...` invocation (or a raw SQL file). Each step must leave the app bootable and the dev server runnable.

### Migration 1 — `00_preflight_backup` (manual, not Prisma)
```
pg_dump $DIRECT_DATABASE_URL > backups/pre-schema-v2-$(date +%Y%m%d-%H%M).sql
```
No code change.

### Migration 2 — `01_add_new_tables_and_enums`
- Create enums: `InterviewType`, `InterviewDifficulty`, `SessionStatus`, `SpeakerRole`, `Recommendation`, `FitStatus`, `LlmPurpose`
- Create empty tables: `auth_sessions`, `resumes`, `job_descriptions`, `report_cards`, `transcript_turns`, `question_evaluations`, `jd_fit_items`, `report_share_links`, `llm_calls`
- Add the corresponding Prisma models to `schema.prisma` alongside existing models.
- **No changes to existing tables.** App keeps running on old schema.

### Migration 3 — `02_extend_users`
- Add: `email_verified BOOLEAN DEFAULT false`, `updated_at`, `deleted_at`
- Rename: `passwordHash` column to `password_hash` (via `@map("password_hash")` in schema → a `ALTER TABLE ... RENAME COLUMN` in the generated SQL).
- Make `name` nullable.
- Remove `@default("")` on `password_hash`. For existing rows with `""`: set `email_verified = false` via a data update in the same migration; those users will be forced through a password-reset flow on next login.
- `id` column remains unchanged — cuid→uuid happens in Migration 8 with careful backfill.

### Migration 4 — `03_extend_interview_sessions_additive`
- Add all new columns as **nullable**: `resume_id`, `job_description_id`, `question_count`, `interview_type`, `difficulty`, `prep_data`, `prep_model`, `prep_completed_at`, `elevenlabs_agent_id`, `elevenlabs_conversation_id`, `call_started_at`, `call_ended_at`, `call_duration_seconds`, `full_audio_url`, `error_message`, `updated_at`, `deleted_at`
- Add `new_status SessionStatus` column (nullable).
- **Don't drop any old columns yet.** The app keeps writing to old columns.
- Add FK constraints on `resume_id`, `job_description_id` with `ON DELETE RESTRICT` (deferred — tables are empty anyway).

### Migration 5 — `04_data_migration` (script, `prisma/migrations/04_data_migration/seed.ts`)
A TypeScript script run once against the new client. Idempotent (skips rows already migrated).

For each `InterviewSession`:
- Create `Resume`: `label = session.title || "Legacy session"`, `file_url = ""`, `file_name = "legacy.txt"`, `file_size_bytes = 0`, `extracted_text = session.resume ?? ""`
- Create `JobDescription`: `label = session.title || "Legacy session"`, `raw_text = session.resumeText`
- Update session: `resume_id`, `job_description_id`, `question_count = planned_questions`, `elevenlabs_conversation_id = eleven_labs_conv_id`, `interview_type = hr_screen`, `difficulty = mid`, `new_status = lowercase(status)`

For each `InterviewResult`:
- Create two `TranscriptTurn` rows:
  - `{ session_id, turn_index: 2*order, speaker: "interviewer", content: result.question, start_ms: 0, end_ms: 0, question_index: order }`
  - `{ session_id, turn_index: 2*order + 1, speaker: "candidate", content: result.answer, start_ms: 0, end_ms: 0, question_index: order }`

Skip: `summary` → `ReportCard` translation (per §0.5).

Validation after run: `SELECT COUNT(*) FROM transcript_turns = 2 * (SELECT COUNT(*) FROM interview_results)`. Fail loud if mismatched.

### Migration 6 — `05_tighten_interview_sessions`
Precondition: Migration 5 ran successfully.
- Mark `resume_id`, `job_description_id`, `question_count`, `interview_type`, `difficulty`, `new_status` as NOT NULL.
- Drop old columns: `domain`, `resume_text`, `resume`, `title`, `planned_questions`, `eleven_labs_conv_id`, `status` (old enum column), `summary`, `completed_at`. `mode` — drop or keep per §0.3 decision.
- Rename `new_status` → `status`.
- Drop old `InterviewStatus` enum type.

### Migration 7 — `06_drop_interview_result`
Precondition: Migration 5 validated. Run pre-check `SELECT COUNT(*) FROM transcript_turns / 2 = (SELECT COUNT(*) FROM interview_results)`.
- `DROP TABLE interview_results;`

### Migration 8 — `07_migrate_user_id_to_uuid` (most delicate — maintenance window recommended)
Single transaction. User-facing DB downtime: ~minutes.

For `users.id`:
- `ALTER TABLE users ADD COLUMN new_id uuid DEFAULT gen_random_uuid() NOT NULL;`
- For every child FK table (resumes, job_descriptions, interview_sessions, llm_calls, auth_sessions): `ALTER TABLE <child> ADD COLUMN new_user_id uuid;`
- Backfill each child: `UPDATE child SET new_user_id = u.new_id FROM users u WHERE child.user_id = u.id;`
- Drop old FKs, drop old `user_id` columns, rename `new_user_id` → `user_id`.
- On `users`: drop old `id` (cuid string PK), rename `new_id` → `id`, re-establish PK and FK constraints pointing at the new `id`.

Same process for `interview_sessions.id` (cuid → uuid) with child tables: `transcript_turns`, `report_cards`, `question_evaluations` (via `report_card_id`), `jd_fit_items`, `report_share_links`, `llm_calls`.

This step is the only one that risks data loss if interrupted. Run with `BEGIN; ... COMMIT;` wrapping.

### Migration 9 — `08_partial_indexes_raw_sql`
Raw SQL file — see §6.

---

## 5. Soft-delete client extension (`lib/prisma.ts`)

Prisma 7 removed legacy `$use` middleware. Replacement: **Client Extensions** via `$extends`.

Target sketch (not yet written):

```ts
// lib/prisma.ts

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const SOFT_DELETE_MODELS = new Set(["User", "Resume", "JobDescription", "InterviewSession"]);

function withSoftDelete<T extends PrismaClient>(base: T) {
  return base.$extends({
    name: "soft-delete",
    query: {
      $allModels: {
        async findFirst({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args.where = { AND: [{ deletedAt: null }, args.where ?? {}] };
          }
          return query(args);
        },
        async findMany({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args.where = { AND: [{ deletedAt: null }, args.where ?? {}] };
          }
          return query(args);
        },
        async findUnique({ model, args, query }) {
          // findUnique disallows extra where clauses. Rewrite callers to use findFirst
          // when soft-delete filtering is needed. Document in lib/prisma.ts.
          return query(args);
        },
        async delete({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            // Rewrite to update({ deletedAt: now() }). Must dispatch via $allOperations since
            // args shape differs between delete and update. Implementation detail during code phase.
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            // updateMany with { deletedAt: now() }
          }
          return query(args);
        },
      },
    },
  });
}

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Default client — applies soft-delete filtering. Use everywhere except admin tools. */
export const prisma = withSoftDelete(base);

/**
 * Unfiltered client — bypasses soft-delete. Use ONLY for admin tools, data export,
 * and restore flows. Every import site must include a one-line `// why:` comment.
 */
export const prismaAdmin = base;
```

**Opt-out pattern**: `import { prismaAdmin }` with a mandatory `// why:` comment. Grep-policed in code review; default is always `prisma`.

**Known caveats** (to resolve during implementation):
- `findUnique` can't accept extra `where` — rewrite soft-delete-sensitive callers to `findFirst`. Document the rule inline.
- Nested includes of soft-deletable relations don't auto-filter. Callers must write `include: { sessions: { where: { deletedAt: null } } }`. Add a linting rule or helper.
- `$queryRaw` / `$executeRaw` are NOT filtered. Raw SQL callers add `WHERE deleted_at IS NULL` themselves.
- Deleting cascades: a hard-delete on a parent (e.g., actual `DELETE FROM users`) will cascade through child tables that use `ON DELETE CASCADE`. The soft-delete extension should only soft-delete the parent; children remain untouched with `deletedAt = null`. The existing FK cascades still apply to hard deletes through `prismaAdmin`.

---

## 6. Partial indexes (raw SQL migration)

Prisma schema can't express partial indexes. File: `prisma/migrations/08_partial_indexes/migration.sql`, runs **after** all table-shape migrations.

```sql
-- Users: unique email across non-deleted rows only.
CREATE UNIQUE INDEX users_email_active_key
  ON users (email)
  WHERE deleted_at IS NULL;

-- Resume library: user's resumes newest first.
CREATE INDEX resumes_user_updated_active_idx
  ON resumes (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- JD library: same pattern.
CREATE INDEX job_descriptions_user_updated_active_idx
  ON job_descriptions (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Session history: user's sessions newest first, excluding soft-deleted.
CREATE INDEX interview_sessions_user_created_active_idx
  ON interview_sessions (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Report cards: "current card for this session" lookup.
CREATE INDEX report_cards_session_current_idx
  ON report_cards (session_id)
  WHERE is_current = true;

-- Share links: lookup live (non-revoked) tokens.
-- (Expiry check intentionally NOT in the predicate — now() is STABLE, not IMMUTABLE.
--  Callers filter expires_at at query time.)
CREATE INDEX report_share_links_token_active_idx
  ON report_share_links (token)
  WHERE revoked_at IS NULL;

-- LLM observability: triage failures by purpose, newest first.
CREATE INDEX llm_calls_purpose_failed_idx
  ON llm_calls (purpose, created_at DESC)
  WHERE succeeded = false;
```

Revisit once the app runs in anger and `pg_stat_statements` reveals actual hot queries.

---

## 7. Open decisions (must answer before execution)

Summary of §0 prompts — we can't run Migration 2 until each has a concrete answer:

1. **Generator provider** — confirm swap `prisma-client-js` → `prisma-client` with `output = "../lib/generated/prisma"`. (Recommended fix.)
2. **`InterviewSession.mode`** — keep explicit (A), derive (B), or drop text mode (C)? Recommend A or C.
3. **`Resume.fileUrl/fileName/fileSizeBytes`** — make nullable for now (A), or commit blob storage (B)? Recommend A.
4. **Legacy `summary` handling** — drop without synthesizing ReportCards (A), or synthesize (B)? Recommend A.
5. **UUID migration maintenance window** — ~5 minutes of DB downtime acceptable for Migration 8? If not, we shard the swap per-table over multiple deploys.
6. **Auth strategy flip** — invalidate all JWTs on switchover (A), or dual-strategy grace period (B)? Recommend A.

Answers move directly into the `schema.prisma` rewrite and the data migration script.

---

## 8. Execution contract

Upon approval of this plan:
1. I commit this file (`prisma/migrations-plan.md`) and `docs/AUDIT.md` — nothing else.
2. You answer §7.
3. We execute the migrations above, one at a time, each as its own PR. `schema.prisma` is edited only during the matching migration step; never ahead.
4. After each migration, verification: `npx prisma migrate status` (no drift), `npx tsc --noEmit`, `npm run lint`, smoke-test the key user flows (login, start interview, end interview).

No migrations run until §7 is answered and this document is committed.
