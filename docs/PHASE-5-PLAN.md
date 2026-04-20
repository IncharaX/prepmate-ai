# Phase 5 Plan — Pre-call prep (planner LLM + LLM call logging)

_Pre-code planning doc. Read `docs/AUDIT.md`, `docs/PHASE-2-PLAN.md` (library), `docs/PHASE-3-PLAN.md` (dynamic variables) for baseline. This phase is where the `pending` status from the session lifecycle finally becomes load-bearing, and where we start writing `LlmCall` rows._

---

## 0. Ground rules

Before touching anything I re-check:

| Library / API | Source | Why |
| --- | --- | --- |
| Zod 4 | `node_modules/zod/lib/index.d.ts` | Confirm `z.enum` + `z.array` + `safeParse` API, and that `parsedData` Json writes don't need sentinel (just raw object). |
| Next.js 16 `after()` | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` (or similar) | Non-blocking background work in route handlers — used for fire-and-forget `parseResume` / `parseJd` after upload. |
| OpenRouter JSON response_format | existing `lib/ai.ts::callOpenRouter` | Already uses `response_format: { type: "json_object" }`. Will keep and set `temperature: 0.2` for the planner. |
| Prisma 7 `Json` writes | `lib/generated/prisma/...` | Accepts plain JS object; `Prisma.JsonNull` only needed for explicit null writes. We never write null in this phase. |
| Cost math | [openrouter.ai/docs](https://openrouter.ai/docs) | Pricing per 1M tokens; OpenRouter passes the provider's actual billed tokens back in the `usage` field of the response. We read that + multiply by our per-model rate. |

---

## 1. What this phase changes vs today

**Today** (post-Phase 3):
- `startInterviewAction` creates session with `status: "ready"` (voice) or `"in_progress"` (text) → redirects straight to `/interview/[id]` (voice room).
- No LLM call is ever made before the candidate hits "Start call." Maya gets just the raw JD + resume.
- The `LlmCall` table exists but zero rows are ever written.
- `parsedData` on `Resume` and `JobDescription` is always `null`.

**After Phase 5**:
- `startInterviewAction` creates session with `status: "pending"` → redirects to `/interview/[id]/prepare`.
- The prepare page triggers `prepareInterviewSession(sessionId)` which calls the planner LLM, gets a structured question plan, writes it to `session.prepData`, flips status to `ready`, and shows the candidate a friendly "Maya will cover: warmup, resume probe, role-fit, wrap" preview.
- User clicks "Start call" → navigates to `/interview/[id]` → voice flow same as Phase 3.
- Every LLM call (planner, parser, existing evaluator stubs later) writes one row to `llm_calls` with prompt, response, tokens, cost, latency, success flag.
- `POST /api/elevenlabs/signed-url` adds a new `question_plan` dynamic variable — a compact numbered list Maya can reference.
- Resume/JD uploads kick off a fire-and-forget `parseResume` / `parseJd` after the response is sent. If these succeed, `parsedData` is populated for future use; if they fail, we ignore — prep works from raw text anyway.

---

## 2. Scope boundaries

**This phase does NOT:**
- Rebuild text-mode scoring (still stubbed — Phase 6).
- Write `ReportCard` / `QuestionEvaluation` / `JdFitItem` rows (Phase 6).
- Migrate `lib/ai.ts`'s existing callers (`generateInterviewQuestion` / `evaluateInterviewAnswer` / `generateInterviewSummary`) to the new logger wrapper. They stay as-is — they're only called from stubbed code paths today. I'll migrate them when Phase 6 resurrects them.
- Retry failed prep automatically. User sees an error state with a retry button.
- Show prep progress (streaming, step-by-step). Just a spinner + "This usually takes 10–20 seconds" copy.
- Add a per-user rate limit on prep calls. One row per session; re-running an already-successful prep is a no-op.

---

## 3. Open decisions (recommendation in bold)

1. **File layout for logging**: single new file `lib/llm.ts` that exposes `callLlmJson<T>({ purpose, model, prompt, userId, sessionId, schema })` wrapping OpenRouter + zod validation + LlmCall write. **→ Single file**, not a separate `lib/llm-log.ts`. The logging is cheap and inseparable from the call shape we want.
2. **Does `lib/ai.ts` migrate?** **→ No, not this phase.** Its existing callers are stubbed. Leave them alone; Phase 6 rewrites that code and will port it to `lib/llm.ts` at the same time. Keeping `ai.ts` intact means zero risk of regressing the text-mode code path or voice-end-call code path.
3. **Planner model default**: **→ `anthropic/claude-sonnet-4.5`** (strong structured-output, handles long context well). Env var `OPENROUTER_PLANNER_MODEL` overrides. The existing `OPENROUTER_MODEL` stays as the default for everything else and is unchanged.
4. **Per-model pricing table location**: **→ `lib/llm-pricing.ts`** (static const map keyed by OpenRouter model string → `{ inputPer1M: number; outputPer1M: number }`). If the model isn't in the table, cost is logged as `null` and a `console.warn` fires once per process. I'll seed the table with: claude-sonnet-4.5, claude-haiku-4.5, gpt-4o, gpt-4o-mini, llama-3.1-8b-instruct. We can extend as we onboard models.
5. **Cost accuracy**: OpenRouter returns `usage: { prompt_tokens, completion_tokens }` in their completion responses — we read these directly rather than estimating. If the field is missing, we fall back to null and log a warning. No token-counting libraries on our side.
6. **Prep page loading UX**: **→ Client-triggered action + `router.refresh()`** (mirror the `AutoFinalizer` pattern from Phase 2). Server-component-await would block the response for 10–20s which Next.js/Vercel edge would time out. Client component + useEffect + ref guard is battle-tested here.
7. **Prep page idempotency**: `prepareInterviewSession(sessionId)` checks `session.prepCompletedAt != null` → returns `{ ok: true, alreadyDone: true }` without calling the LLM. The prepare page server component also redirects immediately to `/interview/[id]` if status is already `ready` or later.
8. **`questionCount` from session must be respected** by the planner. Zod schema enforces the array length. If the LLM returns 8 when we asked for 7, we accept (just log a warning) — pragmatic; models occasionally miscount. Hard rejection would fail too often.
9. **`question_plan` dynamic variable format**: compact numbered list, each line `N) [category] one-line question preview`. Example: `"1) [warmup] How are you thinking about this role?"`. Max 2000 chars; truncate at word boundary with existing `truncateAtWord` helper. Rationales and full questions stay in DB, not sent to the agent.
10. **Does Maya's prompt need updating on the dashboard?** **Yes, one paste**. We add a small block that references `{{question_plan}}`. Small, documented in `docs/elevenlabs-agent-setup.md`. User deploys the change in the dashboard when they're ready; the app sends the variable regardless.
11. **Background parsing using `after()`**: Next 16 ships `after()` from `next/server` — runs the callback after the response is sent. **→ Use this for `parseResume` / `parseJd`**. Failure is swallowed (logged only); prep works without parsed data.
12. **Parsed data shape**: I'll use loose JSON (no strict zod schema on `Resume.parsedData` / `JobDescription.parsedData` at the DB level — they're `Json?`). I'll define TS types in `lib/prompts/parsers.ts` that describe what the LLM outputs, but we don't throw on shape mismatch — we just save whatever parses.
13. **Failure → `status = failed`?** Yes, per user spec. Plus `errorMessage` on the session. Retry button on the prepare page re-calls the action; on re-success, status flips to `ready`.
14. **Prompt versioning / rubric versioning**: out of scope. The planner prompt lives in `lib/prompts/planner.ts`; any change is a new Git commit. If we need rubric versioning for ReportCard in Phase 6, we'll add it then.

---

## 4. Files to CREATE

| Path | Purpose |
| --- | --- |
| `lib/llm.ts` | `callLlmJson<T>({ purpose, model, prompt, userId?, sessionId?, schema })`. Single function that: (a) calls OpenRouter, (b) extracts JSON, (c) validates with the provided zod schema, (d) writes one `LlmCall` row on completion with prompt/response/tokens/cost/latency/succeeded, (e) returns the parsed value or throws `LlmCallError`. |
| `lib/llm-pricing.ts` | `PRICING: Record<string, { inputPer1M: number; outputPer1M: number }>`. Exported `estimateCost({ model, inputTokens, outputTokens })` returns `Decimal` (or null if model unknown). |
| `lib/prompts/planner.ts` | Exported `plannerSystemPrompt` + `buildPlannerUserPrompt({ resume, jd, questionCount, interviewType, difficulty })` + `plannerResponseSchema` (zod) + inferred TS type. |
| `lib/prompts/parsers.ts` | `resumeParserPrompt` / `jdParserPrompt` builders + loose zod schemas for the outputs (validated best-effort; failures write null `parsedData`). |
| `app/actions/prepare.ts` | `prepareInterviewSession(sessionId)` server action. Loads session, short-circuits if `prepCompletedAt` set, calls `callLlmJson` with the planner schema, updates `prepData` / `prepModel` / `prepCompletedAt` / `status = "ready"`. On failure: `status = "failed"` + `errorMessage`. Also exposes `retryPrepAction(sessionId)` that clears `errorMessage` and re-calls. |
| `app/interview/[id]/prepare/page.tsx` | Server component: `requireUser` + ownership + mode check. If `status ∈ { ready, in_progress, completed, completed_partial }` → redirect to `/interview/[id]` (no need to prep again). If `status == "failed"` → render the `<PrepareClient>` in "error + retry" mode. Otherwise render `<PrepareClient>` that kicks off prep on mount. |
| `app/interview/[id]/prepare/PrepareClient.tsx` | Client component: triggers `prepareInterviewSession` via useEffect (StrictMode-guarded ref). Shows a friendly loader, then once successful renders a "Maya will cover:" preview + "Start call" button that navigates to `/interview/[id]`. If failed: error message + "Retry" button calling `retryPrepAction`. |

## 5. Files to MODIFY

| Path | Change |
| --- | --- |
| `app/actions/interview.ts` | `startInterviewAction`: voice-mode sessions now create with `status: "pending"` (not `"ready"`). Redirect destination changes from `/interview/[id]` → `/interview/[id]/prepare`. Text-mode flow unchanged (it was already stubbed). |
| `app/api/elevenlabs/signed-url/route.ts` | When `session.prepData` is populated, add `question_plan` to `dynamicVariables` — a compact `N) [category] question` list, truncated at 2000 chars. If `prepData` is missing (status skipped prep somehow), pass an empty string so Maya's prompt still interpolates cleanly. Also gate on `status ∈ { ready, in_progress }` — reject `pending` with a clear "Interview is still preparing" error so the voice room never starts against an un-prepped session. |
| `app/api/resumes/route.ts` | After `201` response, trigger `parseResume(resumeId)` via `after()` from `next/server`. Swallow errors. |
| `app/api/job-descriptions/route.ts` | Same pattern: trigger `parseJd(jdId)` via `after()`. |
| `lib/validation.ts` | No schema changes. (`startInterviewSchema` still accepts `mode` as-is.) |
| `app/interview/[id]/page.tsx` | Defensive: if status is `"pending"` when the live page loads (user bypassed prepare page somehow), redirect back to `/interview/[id]/prepare`. |
| `docs/elevenlabs-agent-setup.md` | Document the new `question_plan` variable in §1 (table) and §5 (variable registration). Update §4 system prompt template to reference `{{question_plan}}`. User applies this to the dashboard manually. |
| `.env.example` | Add `OPENROUTER_PLANNER_MODEL="anthropic/claude-sonnet-4.5"` with a commented-out default note. |

---

## 6. Everything affected by the status-lifecycle + redirect shift

Short list since the surface is narrow:

1. **`startInterviewAction`** — creates as `pending` (was `ready`) and redirects to `/prepare` (was `/interview/[id]`).
2. **`/api/elevenlabs/signed-url`** — rejects `pending` status with 409, accepts `ready` / `in_progress`.
3. **`/interview/[id]/page.tsx`** (voice room server shell) — redirects `pending` sessions back to prepare page; status checks for `completed*` unchanged.
4. **Dashboard list** (`app/dashboard/page.tsx`) — status badge rendering should include `pending` variant ("Preparing…"). One extra `if` in the `StatusBadge` helper.

Everything else (library UI, auth, detail page, text-mode stubs, voice room client, end-call action) is untouched.

---

## 7. Contract for `lib/llm.ts::callLlmJson`

```ts
export type LlmCallResult<T> =
  | { ok: true; data: T; callId: string }
  | { ok: false; error: string; callId: string | null };

export async function callLlmJson<T>(opts: {
  purpose: LlmPurpose;                     // interview_prep | resume_parse | jd_parse | ...
  model: string;                           // OpenRouter model slug
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  schema: z.ZodType<T>;                    // validates the returned JSON
  userId?: string;                         // optional linkage for llm_calls.user_id
  sessionId?: string;                      // optional linkage for llm_calls.session_id
  temperature?: number;                    // default 0.2
  timeoutMs?: number;                      // default 60_000
}): Promise<LlmCallResult<T>>;
```

- ALWAYS writes exactly one `LlmCall` row, win or lose. Row includes: purpose, model, provider ("openrouter"), prompt (JSON of the messages), response (raw content or null), inputTokens / outputTokens / costUsd (from response.usage × pricing table, null if unknown), latencyMs, succeeded, errorMessage, attemptNumber: 1.
- Returns the callId so the caller can correlate with the DB row if needed.
- Failure modes: network error, non-2xx status, JSON parse failure, zod validation failure — all bubble up as `{ ok: false, error }` after the row is written.

---

## 8. Contract for `prepareInterviewSession(sessionId)`

```ts
export type PrepareResult =
  | { ok: true; alreadyDone?: true }
  | { ok: false; message: string };

export async function prepareInterviewSession(sessionId: string): Promise<PrepareResult>;
```

Behavior:
1. `requireUser()` + ownership check.
2. Load session with resume + jobDescription.
3. If `session.prepCompletedAt != null` → `{ ok: true, alreadyDone: true }`.
4. If `status ∈ { completed, completed_partial, failed, abandoned }` except `failed` (which we want to allow retry) → return `{ ok: true, alreadyDone: true }` to keep the UX unstuck.
5. Build planner prompt from resume/JD/questionCount/interviewType/difficulty.
6. `callLlmJson({ purpose: "interview_prep", model: env.OPENROUTER_PLANNER_MODEL ?? "anthropic/claude-sonnet-4.5", ...schema: plannerResponseSchema })`.
7. On success: `update({ prepData: <parsed>, prepModel: model, prepCompletedAt: now, status: "ready", errorMessage: null })`. `revalidatePath('/interview/[id]/prepare')`.
8. On failure: `update({ status: "failed", errorMessage: <truncated to 300 chars> })`. Return `{ ok: false, message }`.

`retryPrepAction(sessionId)` is the same function under a different name, allowed when `status === "failed"`.

---

## 9. Planner prompt shape (abridged — real text lives in `lib/prompts/planner.ts`)

**System prompt** (constant, non-trivial):
> You are the interview planner inside PrepMate AI. You read a candidate's resume, a job description, and the session parameters (question count, interview type, difficulty), and return a structured question plan that the voice interviewer ("Maya") will follow. You are precise, grounded strictly in the documents provided, and you never invent facts about the candidate or the company. You always return valid JSON that matches the schema exactly.

**User prompt** (template):
- `QUESTION_COUNT: 7`
- `INTERVIEW_TYPE: hr_screen`
- `DIFFICULTY: mid`
- `JOB_DESCRIPTION: <...>`
- `CANDIDATE_RESUME: <...>`
- Explicit instruction: "Return exactly {{QUESTION_COUNT}} questions in the `questionPlan` array, each with index 1–N. First must be a warmup. Last must be a wrap. Middle can mix categories but include at least one `resume_probe` and one `jd_fit` when the question count ≥ 4."

**Response schema** (zod):
```ts
export const plannerResponseSchema = z.object({
  resumeSummary: z.string().min(20).max(2000),
  jdSummary: z.object({
    mustHaves: z.array(z.string()).min(1).max(10),
    niceToHaves: z.array(z.string()).max(10),
    seniority: z.string().max(50),
    domain: z.string().max(80),
  }),
  questionPlan: z.array(z.object({
    index: z.number().int().min(1).max(20),
    category: z.enum(["warmup", "resume_probe", "jd_fit", "behavioral", "scenario", "wrap"]),
    question: z.string().min(10).max(400),
    rationale: z.string().max(400),
  })).min(1).max(12),
});
```

No dependency on `questionCount` at the zod layer — we log a warning if the returned length ≠ requested but accept it.

---

## 10. UI sketch — `/interview/[id]/prepare`

Single-column, centered, calm. Same cream/navy/amber palette as the rest of the app.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              (small serif label) Preparing               │
│                                                          │
│     Maya is reading your resume and the job posting.     │
│                 Usually 10 – 20 seconds.                 │
│                                                          │
│                       ⟳ (spinner)                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Once `prepData` lands, same page re-renders with:

```
┌──────────────────────────────────────────────────────────┐
│              (small serif label) Ready                   │
│                                                          │
│     Here's what Maya will cover with you today.          │
│                                                          │
│     01 · Warmup                                          │
│     02 · A probe on your Proofofskill role               │
│     03 · Role fit for the Stripe FE position             │
│     04 · A scenario on performance under deadline        │
│     05 · Wrap — your questions for her                   │
│                                                          │
│     [  Start call with Maya  →  ]                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Preview strings come from `session.prepData.questionPlan[i].category` mapped to human phrasing. Full questions and rationales stay in the DB, never rendered to the candidate (we don't want to reveal the plan).

Failure state: replace spinner with an error badge + "Maya couldn't finish preparing — [retry]". Retry calls `retryPrepAction`.

---

## 11. Verification plan

1. `npm run build` + `npm run lint` clean.
2. Create a fresh voice interview → browser lands on `/interview/[id]/prepare` with a spinner. After ~10–20s, UI flips to "Here's what Maya will cover" with N bullet points. DB: `interview_sessions.status = ready`, `prep_data` populated, `prep_model = claude-sonnet-4.5`, `prep_completed_at` set.
3. One `llm_calls` row written with `purpose = interview_prep`, `model = claude-sonnet-4.5`, `provider = openrouter`, `succeeded = true`, non-null tokens + cost.
4. Click "Start call" → `POST /api/elevenlabs/signed-url` response contains `dynamicVariables.question_plan` ≤ 2000 chars, numbered list format. Call connects; DB shows `status = in_progress`, `call_started_at` set.
5. Upload a new resume → one `llm_calls` row with `purpose = resume_parse` fires after the 201 response (look in dev console / db_studio). On success, `resumes.parsed_data` populated; on failure, still null.
6. Paste a new JD → same pattern with `purpose = jd_parse`.
7. Force a planner failure (e.g. set `OPENROUTER_PLANNER_MODEL` to a bogus slug, restart). Prepare page lands in error state; `interview_sessions.status = failed`, `error_message` set. Hit retry with a valid model → recovers to `ready`.
8. Open an already-ready session's `/interview/[id]/prepare` URL → immediate redirect to `/interview/[id]`.
9. Open a voice session that's somehow still `pending` via `/interview/[id]` → redirect to `/prepare`.

---

## 12. Execution order (once approved)

1. `lib/llm-pricing.ts` — static table + helper (pure, no deps).
2. `lib/llm.ts` — `callLlmJson` wrapper.
3. `lib/prompts/planner.ts` — prompt + schema.
4. `lib/prompts/parsers.ts` — prompts + loose schemas for resume / JD parsing.
5. `app/actions/prepare.ts` — `prepareInterviewSession` + `retryPrepAction` + internal `parseResume` / `parseJd` callers.
6. `app/interview/[id]/prepare/page.tsx` + `PrepareClient.tsx`.
7. `app/actions/interview.ts` — `startInterviewAction` status + redirect change.
8. `app/api/elevenlabs/signed-url/route.ts` — `question_plan` dynamic variable, gate `pending` status.
9. `app/api/resumes/route.ts` + `app/api/job-descriptions/route.ts` — `after()` hooks for background parsing.
10. `app/interview/[id]/page.tsx` — defensive pending → prepare redirect.
11. `app/dashboard/page.tsx` — `pending` status badge variant.
12. `docs/elevenlabs-agent-setup.md` — document `question_plan`.
13. `.env.example` — `OPENROUTER_PLANNER_MODEL`.
14. `npm run build` + lint + manual walk-through.
15. Report.

---

## 13. Stop contract

No code until approved. When you say go, I'll execute in the order above. Will report what's green and what's broken (and still-stubbed Phase-6 stuff) at the end.
