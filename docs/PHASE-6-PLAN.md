# Phase 6 Plan — Production-grade evaluation (rubric, cited quotes, ReportCard)

_Pre-code planning doc. Read `docs/AUDIT.md`, `docs/PHASE-5-PLAN.md` (for `callLlmJson` + `LlmCall` logging plumbing), and the `ReportCard` / `QuestionEvaluation` / `JdFitItem` schema in `prisma/schema.prisma`._

---

## 0. Ground rules

Before touching anything I re-check:

| Library / API | Source | Why |
| --- | --- | --- |
| Zod 4 | `node_modules/zod/...` | Confirm the `.transform` + `.refine` surface for score-clamping helpers. |
| Prisma 7 transactions | `lib/generated/prisma/client.ts` | `prisma.$transaction(array)` for the atomic write of `ReportCard` + `QuestionEvaluation` + `JdFitItem`. Ensure the soft-delete extension doesn't trip — these three models don't have `deletedAt`, so the extension leaves them alone. |
| `lib/llm.ts::callLlmJson` (Phase 5) | existing | All three new LLM calls go through this. Writes one `llm_calls` row each. |
| Next.js 16 `after()` | `node_modules/next/dist/server/after/after.d.ts` | Fire-and-forget evaluation from `endVoiceCallAction`. |
| `Prisma.Recommendation` / `Prisma.FitStatus` enum types | `lib/generated/prisma/enums.ts` | Exact values: `strong_yes | yes | maybe | no | strong_no` and `met | partial | unclear | not_shown`. |

---

## 1. What changes vs today

**Today:**
- `scoreVoiceSessionAction` is a stub that returns `{ ok: true }` and does nothing (`app/actions/interview.ts:~215`). No ReportCard is ever created.
- `endVoiceCallAction` writes `TranscriptTurn` rows already — good baseline for Phase 6.
- Detail page at `app/dashboard/interview/[id]/page.tsx` reads `ReportCard` + `TranscriptTurn` but because `ReportCard` is always empty post-Phase 5, it always shows the "no card" state. `AutoFinalizer` still lives but its action is the stub.
- `QuestionEvaluation` and `JdFitItem` tables exist and are always empty.

**After Phase 6:**
- A new `evaluateInterviewSession(sessionId)` server action is the only path that writes `ReportCard` + `QuestionEvaluation[]` + `JdFitItem[]`.
- Triggered in three places, all idempotent (short-circuit on existing `isCurrent` ReportCard):
  1. Fire-and-forget from `endVoiceCallAction` via `after()` — normal happy path; redirect isn't blocked.
  2. Defensive kick from the detail page's client "poller" component if the card still isn't there after ~5s — covers `after()` misses (cold lambda, crash, deploy-while-running).
  3. Manual retry button on the detail page if evaluation landed in an error state.
- Runs **three parallel LLM calls**: overall rubric scoring, per-question evaluation (concurrency-capped at 3 across N questions), JD-fit matrix. Every call logged via `callLlmJson` into `llm_calls`.
- Atomic DB write: one transaction inserts the `ReportCard` and all its child rows. No half-states visible to readers.
- Detail page renders from `ReportCard` + `QuestionEvaluation` + `JdFitItem`, with polling skeleton while the eval is in flight.
- Legacy scoring code (`scoreVoiceSessionAction`, `scoreVoiceSessionResult` type, the old `AutoFinalizer` that calls it, the stale `SummaryShape` parser on the detail page reading `session.summary` Json) is **deleted** — no dead paths left.

---

## 2. Scope boundaries

**This phase does NOT:**
- Add share links. `ReportShareLink` stays unused. Phase 7.
- Re-run an eval just because the rubric changed. `rubricVersion` is recorded on the row; admin can invalidate-and-retry later.
- Support multiple report cards per session as a user-facing feature. The `isCurrent` flag is there; only one row is created for now. When we re-score, we'll flip the old one to `isCurrent=false` and insert a new one — that's a future concern.
- Touch text-mode scoring — text mode is still stubbed. Evaluation assumes `mode === "voice"` with transcript turns present. Text sessions simply won't produce ReportCards until text-mode is rebuilt in a later phase.
- Add rubric versioning UI or admin tools to view it.
- Display `LlmCall` rows / cost in the UI (still `db:studio` only).

---

## 3. Open decisions (recommendation in **bold**)

1. **Evaluator model default**: `anthropic/claude-sonnet-4.5` for all three calls, configurable via `OPENROUTER_EVALUATOR_MODEL`. **→ one env var for all three eval calls** (not three different ones). Simpler config; per-call tuning is a YAGNI.
2. **Score scale**: DB columns are `Int`. Anchors land on 20/40/60/80/100 per your spec. LLM returns an integer 0–100; we clamp + round. **→ Yes, use the 0–100 range end to end.** No rescaling at the DB boundary.
3. **Transcript → question mapping heuristic**: you asked for "between Maya's nth question-like turn and the n+1st". Concrete proposal:
   - Filter `transcriptTurns` to `speaker === "interviewer"` in `turnIndex` order.
   - A turn is a "real question" if `content.length ≥ 60 chars` (roughly: long enough to not be a back-channel like "Got it"). We don't require a trailing `?` because Maya often phrases as statements ("Tell me about…"). If fewer than `questionCount` turns pass the length bar, **fall back** to picking the top-N longest agent turns by char length, then resorting by `turnIndex`.
   - Assign the first such turn → `questionIndex = 0`, second → `1`, etc. Everything before the first real-question turn (warm-up chatter) gets `questionIndex = 0` too. Candidate turns after the last real question get the last index.
   - Run as a bulk update inside the evaluation's transaction via `prisma.$transaction(turns.map(t => prisma.transcriptTurn.update({ where: {id}, data: {questionIndex} })))`. For ~30 rows that's fine.
4. **Quote citation mechanism**: pass the transcript to the LLM with a stable `[T#]` prefix on every line (e.g. `[T7] (candidate) I built a pipeline that…`). Ask the LLM to return `turnRef: "T7"` alongside each quote. Server-side we map `T7 → turns[7].id` and populate `turnId`. **→ Clean, deterministic, and lets us drop bogus refs** (map to null if the ref doesn't exist instead of inventing a turn).
5. **Partial-failure policy**: if the **overall** call fails → no report row is written, session gets `errorMessage` + `status = failed` (actually we keep `completed_partial` here — the session itself completed, it's the eval that failed). If per-question calls have ≥1 failure → create the report anyway, skip the failing rows, note in `errorMessage`. If JD-fit fails → create report with zero `JdFitItem` rows, note in `errorMessage`. **→ Matches your spec: don't fake data.**
6. **`completed_partial` status semantics**: currently unused post-migration. I'll use it for sessions where the eval partially failed. Full success flips to `completed`; post-success it stays `completed`. Hard-fail overall eval → `completed_partial` + `errorMessage`. Fresh end-of-call sets `completed`; eval downgrades to `completed_partial` only if things go wrong.
7. **Polling detail page**: server renders initial state; client component polls via a lightweight `getEvaluationStatusAction(sessionId)` every 3 seconds, up to 90 seconds total. If it resolves `ready`, `router.refresh()`. If `error` or timeout, shows a retry button that calls `evaluateInterviewSession` manually. **→ Polling over WebSockets/SSE for simplicity; 90s is generous for eval that averages ~25–40s.**
8. **Concurrency cap for per-question calls**: plan spec says "p-limit concurrency 3". We don't ship `p-limit` yet — the Phase 0 scoring fix already used a hand-rolled `runWithConcurrency` helper. **→ Move that helper to `lib/concurrency.ts` and reuse.** Saves a dep.
9. **Retry on eval failure**: manual button only. No auto-retry this phase — flakey LLMs would spam `LlmCall` rows and cost money.
10. **Strengths / gaps shape**: the DB columns are `Json`. The overall prompt returns `strengths: Array<{ title, detail, transcriptQuote?, turnRef? }>`. Server resolves `turnRef` → `turnId` and stores the array verbatim. Detail page renders title + detail + optional quote + (later, Phase 7) deep link to the turn.
11. **Legacy `SummaryShape` Json on `InterviewSession.summary`**: field survives in the schema but we stop writing to it this phase. I'll keep the column (drops are expensive in prod) and just null it out / ignore it. Detail page reads exclusively from `ReportCard` going forward. **→ Mark the field comment in schema.prisma as deprecated in a later housekeeping commit.**
12. **Rubric version string**: hardcode `"v1"` in code. When we iterate, bump to `"v2"` and bake a migration plan for rescoring. No versioning infrastructure this phase.

---

## 4. Rubric anchors (RUBRIC_V1 — the gold)

Concrete and specific to HR screens. These go in `lib/rubric.ts` as a typed const. The evaluator prompt includes them verbatim so the LLM has explicit calibration targets.

### `communication` — clarity, structure, energy, conversational fit
- **20 — Unclear**: rambles, interrupts themselves, can't finish a thought. Listener ends the turn unsure what was said.
- **40 — Rough**: points are findable but buried in filler. Structure absent; either way too short ("yeah, I did that") or way too long without landmarks.
- **60 — Okay**: thoughts complete, audible enthusiasm, listener rarely confused. Occasional rambling or flat affect.
- **80 — Strong**: answers have obvious structure (signposts like "three things…", clear "situation → action → result"), pace matches the room, modulates when asked a follow-up.
- **100 — Exceptional**: every answer lands like a mini-TED-talk — concise, narrative, natural. Listener could summarise the answer in one sentence after hearing it.

### `jdRelevance` — how well answers connect to what the role actually needs
- **20 — Off-topic**: answers don't reference the role at all, or pull from unrelated experience without bridging. Generic advice / abstract opinions.
- **40 — Loose**: touches the domain but doesn't tie experience back to the specific requirements named in the JD. "I know React, yeah."
- **60 — Relevant**: explicitly names 1–2 JD requirements and maps experience to them. Reasoning is present but light.
- **80 — Targeted**: answers trace directly to specific JD line items — must-haves first, then nice-to-haves. Shows the candidate read the JD carefully.
- **100 — Bullseye**: every answer, including warmups, is framed through the lens of this role. Feels like the candidate is already in the job, describing how they'd operate.

### `experienceDepth` — substance and seniority behind claims
- **20 — Superficial**: claims without evidence ("I've led teams"). No concrete systems, numbers, tradeoffs, or constraints mentioned.
- **40 — Thin**: mentions projects but at a surface level — no scale, no decisions, no failures.
- **60 — Solid**: shares at least one concrete example with scope (team size, timeline, users) and a real decision they owned.
- **80 — Deep**: multiple examples with tradeoffs made, alternatives rejected, concrete metrics (latency, scale, revenue). Shows pattern recognition across situations.
- **100 — Principal-level**: answers reveal a mental model of how systems/people work in the domain. Teaches the interviewer something about the problem space.

### `specificity` — names, numbers, outcomes vs generalities
- **20 — Vague**: answers live at platitude level ("we solved the problem and shipped it"). Zero numbers, zero named tools or people.
- **40 — Fuzzy**: generalities sprinkled with one or two concrete nouns but no measurable outcomes.
- **60 — Concrete**: names the stack, the team, the timeline. Outcomes referenced but loosely ("performance improved").
- **80 — Quantified**: names + numbers + timeframes. "Cut p95 from 800ms → 220ms over 6 weeks by moving the image pipeline to Cloudflare Images."
- **100 — Receipts**: answers sound auditable. Could pull up a PR, a dashboard, or a Google Doc to prove every claim. Nothing generic.

### `confidence` — how the candidate owns their answers under pressure
- **20 — Shaky**: hedges on everything ("I think maybe possibly we might have…"), defers to "the team" when asked personal questions, apologises preemptively.
- **40 — Guarded**: clear answers only when they're safe; flinches on "what was hard?" or "what would you do differently?"
- **60 — Grounded**: comfortable with their own judgment, admits uncertainty cleanly ("I'd want to check X before deciding").
- **80 — Composed**: handles pushback well, reframes surprising questions without losing their footing, distinguishes what they know from what they're guessing.
- **100 — Presence**: makes the interviewer feel they'd be a calm hand in a real crisis. Owns mistakes without drama. Disagrees with the interviewer when warranted, without being combative.

---

## 5. Evaluator prompts (shapes, not verbatim — final text in `lib/prompts/evaluator.ts`)

### Overall (one call per session)
Inputs: resume text, JD text, rubric (embedded verbatim), question plan (from `prepData.questionPlan`), full transcript as `[T#] (speaker) content` lines.

Output schema (zod):
```ts
overallReportSchema = z.object({
  overallScore: intScore,                       // 0-100
  recommendation: z.enum(["strong_yes","yes","maybe","no","strong_no"]),
  recommendationReason: z.string().min(20).max(800),
  scoreCommunication:   intScore,
  scoreJdRelevance:     intScore,
  scoreExperienceDepth: intScore,
  scoreSpecificity:     intScore,
  scoreConfidence:      intScore,
  strengths: z.array(z.object({
    title: z.string().min(3).max(100),
    detail: z.string().min(10).max(400),
    transcriptQuote: z.string().max(300).optional(),
    turnRef: z.string().regex(/^T\d+$/).optional(),
  })).min(1).max(6),
  gaps: z.array(z.object({
    title: z.string().min(3).max(100),
    detail: z.string().min(10).max(400),
    transcriptQuote: z.string().max(300).optional(),
    turnRef: z.string().regex(/^T\d+$/).optional(),
  })).min(1).max(6),
  summary: z.string().min(60).max(1200),
});
```

### Per-question (one call per question, parallelized cap=3)
Inputs: single question from `prepData.questionPlan` (question text + category + rationale), the windowed turns for that question (derived via the heuristic in §6), resume + JD for context, rubric.

Output schema:
```ts
questionEvalSchema = z.object({
  questionIndex: z.number().int().min(0).max(15),
  questionText: z.string().min(5).max(500),
  answerSummary: z.string().min(10).max(400),
  score: intScore,
  whatWorked: z.string().max(400).optional().nullable(),
  whatToImprove: z.string().max(400).optional().nullable(),
  transcriptQuote: z.string().max(300).optional().nullable(),
  turnRef: z.string().regex(/^T\d+$/).optional().nullable(),
});
```

### JD-fit (one call per session)
Inputs: JD must-haves + nice-to-haves from `jobDescription.parsedData` if present, else the full `rawText`. Full transcript. Resume for cross-reference.

Output schema:
```ts
jdFitSchema = z.object({
  items: z.array(z.object({
    requirement: z.string().min(3).max(200),
    isMustHave: z.boolean(),
    status: z.enum(["met","partial","unclear","not_shown"]),
    evidence: z.string().max(300).optional().nullable(),
    turnRef: z.string().regex(/^T\d+$/).optional().nullable(),
  })).min(1).max(20),
});
```

Each prompt states: "Cite a specific turn using its `T#` prefix whenever you reference the transcript. If the claim isn't in the transcript, set `turnRef` to null rather than guessing."

---

## 6. Transcript → question mapping (pure function)

New file: `lib/question-mapping.ts`. Pure — easy to unit test later.

```ts
export function mapTurnsToQuestions(
  turns: { id: string; turnIndex: number; speaker: "interviewer" | "candidate"; content: string }[],
  expectedCount: number,
): {
  questionTurnIds: string[];           // agent turns that are "real questions", in turnIndex order
  turnIdToQuestionIndex: Record<string, number>;  // bulk-update map
};
```

Algorithm:
1. Filter to agent turns, sort by `turnIndex`.
2. Candidate set = agent turns whose `content.length >= 60`.
3. If `candidateSet.length >= expectedCount`: take the first `expectedCount` in `turnIndex` order.
4. Else fall back: sort ALL agent turns by `content.length` descending, take top `expectedCount`, resort by `turnIndex`.
5. `questionTurnIds = chosen.map(t => t.id)`.
6. Walk all turns in `turnIndex` order: maintain a running `currentQ` index that increments each time we hit a `questionTurnIds` member. Assign `currentQ` to every subsequent turn (candidate and interviewer) until the next jump. Candidate turns before the first question go to `questionIndex = 0`.

This is cheap, deterministic, and doesn't require an LLM. Edge cases are documented inline.

---

## 7. `evaluateInterviewSession` server action — flow

```
// app/actions/evaluate.ts
evaluateInterviewSession(sessionId):
  1. requireUser() + ownership check.
  2. Load session with transcriptTurns(order by turnIndex), resume, jobDescription, reportCards(where isCurrent=true).
  3. GUARDS (return early with { ok: true, alreadyDone: true }):
       - session.status NOT in ["completed","completed_partial"]  → { ok:false, message:"not ready" }
       - session.mode !== "voice" → { ok:false, message:"text mode not supported" }
       - transcriptTurns.filter(candidate).length === 0 → mark session failed+errorMessage, return
       - isCurrent ReportCard already exists → { ok: true, alreadyDone: true }
  4. Parse planner prepData → questionPlan (zod-safeParse; if malformed, treat as empty plan + warn).
  5. Run mapTurnsToQuestions() → compute bulk update for turns.
  6. Prepare formatted transcript string: each turn prefixed `[T{turnIndex}] ({speaker}) content`.
  7. Kick off three async branches in parallel:
       A. overall = callLlmJson({ purpose: "evaluation", schema: overallReportSchema, model, messages })
       B. perQ   = runWithConcurrency(questions, 3, async (q) =>
                     callLlmJson({ purpose: "question_evaluation", schema: questionEvalSchema, ... }))
       C. jdFit  = callLlmJson({ purpose: "jd_fit_analysis", schema: jdFitSchema, ... })
     await Promise.allSettled([A, B, C])
  8. If A failed → mark session `completed_partial` + errorMessage, return { ok:false, message }.
     (No report row at all — your spec: "If overall fails: no report.")
  9. Resolve turnRef → turnId by mapping through a `refMap: Record<"T<turnIndex>", turnId>`. Drop refs that don't resolve.
 10. $transaction([
       // (a) Bulk-update turnIndex on turns. Many individual updates batched in one tx.
       ...turns.map(t => prisma.transcriptTurn.update({ where:{id:t.id}, data:{questionIndex:...} })),
       // (b) Flip any prior current ReportCard to isCurrent=false (defensive — guard says no prior exists, but races happen).
       prisma.reportCard.updateMany({ where:{sessionId, isCurrent:true}, data:{isCurrent:false} }),
       // (c) Create the new ReportCard with nested QuestionEvaluation + JdFitItem arrays.
       prisma.reportCard.create({ data: { ...overall.data, rubricVersion:"v1", evaluatorModel: modelName,
         questionEvaluations: { create: perQResultsOk.map(mapToEvalRow) },
         jdFitItems:          { create: jdFitItemsOk.map(mapToFitRow) },
       }}),
     ])
 11. If perQ had partial failures or jdFit failed → update session with
     { status:"completed_partial", errorMessage: "evaluation partial: X/Y questions scored, JD-fit: ok|failed" }.
     Else → { status:"completed", errorMessage: null }.
 12. revalidatePath(`/dashboard/interview/${sessionId}`) + revalidatePath("/dashboard").
 13. return { ok: true }.
```

Called from three places (all idempotent via the guard on step 3):
1. **`endVoiceCallAction`** — after transcript is written + status=completed, `after(async () => evaluateInterviewSession(session.id))`. Non-blocking. The server action returns the redirect without waiting.
2. **Detail-page polling client** — `getEvaluationStatusAction(sessionId)` returns one of `{ status: "pending" | "ready" | "error" }`. Client polls every 3s. If `pending` for >5s and no running eval detected (heuristic: no recent `LlmCall` rows for this session), kick `evaluateInterviewSession` once as a fallback.
3. **Manual retry button** — on eval-error state, fires `evaluateInterviewSession` directly.

---

## 8. Files to CREATE / MODIFY / DELETE

### CREATE

| Path | Purpose |
| --- | --- |
| `lib/rubric.ts` | `RUBRIC_V1` const (the anchor text in §4), `RUBRIC_VERSION = "v1"`, `intScore` zod helper (`z.number().int().min(0).max(100)`). |
| `lib/prompts/evaluator.ts` | Three prompt builders + three zod schemas (overall, per-question, JD-fit). Exports `evaluatorSystemPrompt` constant shared across the three. |
| `lib/concurrency.ts` | Extract `runWithConcurrency(items, n, mapper)` from wherever it currently lives (it was added in the Phase 0 scoring fix). Ship as a standalone pure helper. |
| `lib/question-mapping.ts` | `mapTurnsToQuestions(turns, expectedCount)` pure function (§6). |
| `app/actions/evaluate.ts` | `evaluateInterviewSession(sessionId)` + `getEvaluationStatusAction(sessionId)` + `retryEvaluationAction(sessionId)`. |
| `app/dashboard/interview/[id]/EvaluationPoller.tsx` | New client component replacing `AutoFinalizer`. Polls `getEvaluationStatusAction` every 3s up to 90s; `router.refresh()` on ready; retry button on error. |

### MODIFY

| Path | Change |
| --- | --- |
| `app/actions/interview.ts` | `endVoiceCallAction`: after updating session to `completed`, add `after(async () => evaluateInterviewSession(session.id))`. **Remove** `scoreVoiceSessionAction` entirely — nothing should call it. |
| `app/dashboard/interview/[id]/page.tsx` | Rewrite reads to use `ReportCard` + `QuestionEvaluation` + `JdFitItem`. Drop the `SummaryShape` parser that reads `session.summary` Json. Render: header + overall score tile + recommendation badge + rubric-dim bars (5 rows: communication / jdRelevance / experienceDepth / specificity / confidence) + strengths / gaps columns + JD-fit matrix + per-question transcript panels with cited quotes. Show `<EvaluationPoller>` when session is completed but no `isCurrent` ReportCard exists yet. |
| `docs/elevenlabs-agent-setup.md` | No change. Out of scope. |
| `.env.example` | Add `OPENROUTER_EVALUATOR_MODEL="anthropic/claude-sonnet-4.5"` (commented default). |

### DELETE

| Path | Why |
| --- | --- |
| `app/dashboard/interview/[id]/AutoFinalizer.tsx` | Replaced by `EvaluationPoller.tsx`. Old one calls the deleted `scoreVoiceSessionAction` stub. |

Inside `app/actions/interview.ts`, we delete:
- `scoreVoiceSessionAction` (whole function, ~10 lines).
- `ScoreVoiceSessionResult` type export.

No Prisma schema changes. No migrations. `summary` Json column on `InterviewSession` stays but is no longer written to.

---

## 9. Detail page rewrite sketch

Composition from top to bottom:

```
────── Breadcrumb: Dashboard / <interview title> ──────

[Header card]
  <badge> <mode badge> <date/time>
  "Senior Frontend — Stripe"
  "7 answered · 7 planned · 18 min"
  [Start another ↗]

[EvaluationPoller]  // only when session.status = completed && no ReportCard
  spinner + "Scoring your answers — usually ~30s" ticking
  after ready: router.refresh() pulls the rest of the page

[Once ReportCard exists:]

[Recommendation strip]
  <recommendation pill: "Strong yes" | "Yes" | ... in colors>
  "Overall 72 / 100"
  one-sentence recommendationReason (truncate to ~200 chars with expand)

[Rubric bars card]
  5 rows, each:
    dimension-name mono    ▆▆▆▆▆▆░░░░ 62
  hover: anchor descriptions for that dimension

[Summary paragraph card]
  1-2 paragraphs of `summary` field, serif display heading

[Two-col: Strengths / Gaps]
  each is a list of { title bold, detail, quote block with "from turn T#" subtitle }

[JD-fit matrix]
  single table:
    Requirement                       | Must | Status        | Evidence
    "React 18 in production"          | yes  | ● met         | "I migrated …" [T9]
    "Accessibility (WCAG 2.1)"        | yes  | ○ not_shown   | —
    "Performance budgets < 200ms"     | no   | ◐ partial     | "We had dashboards…" [T14]
  color-code status with tokens we already have
  click a row with a turnRef → scroll the page to that transcript section

[Per-question transcript]
  repeat for each QuestionEvaluation (ordered by questionIndex):
    "01 · [category]" monospace label
    Q: the exact question Maya asked
    A: the candidate's answer text (pulled from the mapped candidate turns, concatenated or rendered as a small multi-turn block)
    [Feedback block]
      score pill (0-100)
      "What worked" short paragraph (whatWorked if present)
      "What to sharpen" short paragraph (whatToImprove if present)
      optional cited transcript quote + "from turn T#" deep-anchor
```

Skeleton version while `EvaluationPoller` is running: gray placeholders in the shape of the rubric bars + summary + first question card so the user sees the shape of the report, not just a spinner.

---

## 10. Verification plan

1. `npm run build` + `npm run lint` clean.
2. Finish a voice interview end-to-end. Expect redirect to `/dashboard/interview/[id]`. Page shows `<EvaluationPoller>` with spinner immediately.
3. Within ~40 seconds page auto-refreshes → ReportCard rendered with all 5 dimension scores, recommendation badge, 2–6 strengths, 2–6 gaps, full JD-fit matrix, and N per-question panels matching `session.questionCount`.
4. `LlmCall` rows:
   - 1 row `purpose=evaluation` with `succeeded=true`, non-null `inputTokens`/`outputTokens`/`costUsd`.
   - N rows `purpose=question_evaluation` (one per mapped question), all `succeeded=true` (ideally).
   - 1 row `purpose=jd_fit_analysis` with `succeeded=true`.
5. Open `TranscriptTurn` in Studio → every turn has a non-null `question_index`. Spot-check a few: warm-up turns before the first real question all share `questionIndex = 0`; the post-wrap turns share the last index.
6. Force an overall failure (set `OPENROUTER_EVALUATOR_MODEL` to a bogus slug, restart, finish a call) → `session.status = completed_partial`, `errorMessage` populated, no ReportCard written. Detail page shows a retry card. Click retry with valid model → recovers.
7. Force a per-question failure only (e.g. one question text too long for the model, hard to repro — can simulate by temporarily throwing inside `runWithConcurrency` for index 0): ReportCard still written, minus one QuestionEvaluation, `errorMessage` says "evaluation partial: N-1/N questions scored". Detail page renders gracefully with that question's panel noted as "not evaluated".
8. Hit the detail page URL for an already-evaluated session → no poller, ReportCard renders immediately, no extra LLM calls fired.
9. Two tabs open on the same just-ended session → eval runs once, not twice (guard on existing `isCurrent` ReportCard holds).
10. Run `npm run db:studio` → `InterviewSession.summary` is null on new sessions. No old-scoring writes happening anywhere.

---

## 11. Execution order (once approved)

1. `lib/rubric.ts` — RUBRIC_V1, RUBRIC_VERSION, intScore helper.
2. `lib/concurrency.ts` — move/extract `runWithConcurrency`.
3. `lib/question-mapping.ts` — pure function.
4. `lib/prompts/evaluator.ts` — three schemas + three prompt builders.
5. `app/actions/evaluate.ts` — action + status action + retry action.
6. `app/dashboard/interview/[id]/EvaluationPoller.tsx` — replacement client.
7. `app/dashboard/interview/[id]/page.tsx` — full rewrite of read path + render.
8. `app/actions/interview.ts` — hook `evaluateInterviewSession` into `endVoiceCallAction` via `after()`. Delete `scoreVoiceSessionAction` + its type export + any imports.
9. Delete `AutoFinalizer.tsx`. Grep for any remaining imports and clean up.
10. `.env.example` — add `OPENROUTER_EVALUATOR_MODEL`.
11. `npx tsc --noEmit` → resolve breakages from removed exports.
12. `npm run build` + `npm run lint`.
13. Manual walkthrough.
14. Report.

---

## 12. Stop contract

No code until approved. When you say go, I'll execute in the order above. Final report will list what's green, what's partial-failure-tolerated, what's out of scope, and any followups (e.g. the detail-page deep-link-to-turn anchor is a nice-to-have I'll mention but not block on).
