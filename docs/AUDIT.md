# PrepMate AI — Codebase Audit

_Generated as a pre-refactor snapshot. Read-only. Reflects the state of `main` at the time of writing._

## 0. Ground rule for the refactor — read the docs

Before we reach for any library below, we read its **current** documentation and match the version pinned in `package.json`. No assumptions from training data. Specifically:

| Library | Pinned version | Canonical docs |
| --- | --- | --- |
| Next.js | `16.2.4` | `node_modules/next/dist/docs/` (project-local — this is a modified Next.js per `AGENTS.md`) |
| Prisma / Prisma Client | `7.7.0` | <https://www.prisma.io/docs> (Prisma 7 renamed the generator to `prisma-client` with `output` required — do NOT use the `prisma-client-js` pattern from older tutorials) |
| Auth.js (next-auth) | `^5.0.0-beta.31` | <https://authjs.dev/> (v5 beta — API differs from v4; JWT strategy currently in use) |
| `@elevenlabs/react` | `^1.1.1` | <https://elevenlabs.io/docs/conversational-ai> + SDK typings at `node_modules/@elevenlabs/react/dist/*.d.ts` (we confirmed `ConversationProvider` is required around `useConversation`) |
| `@elevenlabs/client` | `^1.2.1` | Same docs family as above |
| React | `19.2.4` | <https://react.dev/> (React 19 rules: `params` is a promise in server components; `<script>` tags trigger dev warnings unless in `<head>`; `useActionState` exists) |
| shadcn/ui | new-york style | <https://ui.shadcn.com/docs> (`components.json` specifies `cssVariables: true`, `iconLibrary: "lucide"`) |
| Tailwind CSS | `^4` | <https://tailwindcss.com/docs> (Tailwind v4 uses `@tailwindcss/postcss`, `@theme inline`, no config file) |
| Zod | `^4.3.6` | <https://zod.dev/> (v4 schemas — error API changed vs v3) |
| next-themes | `^0.4.6` | <https://github.com/pacovos/next-themes> (renders an inline `<script>` — known React 19 warning) |

Rule for the refactor: **every time we touch one of these, we re-read the relevant section**. If a required API looks different from what the existing code uses, we don't guess — we grep the installed `dist/*.d.ts` for ground truth (as we did for `ConversationProvider`).

---

## 1. Current Prisma schema

Path: `prisma/schema.prisma`. Verbatim:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../lib/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum InterviewMode {
  TEXT
  VOICE
}

enum InterviewStatus {
  IN_PROGRESS
  COMPLETED
  ABANDONED
}

model User {
  id           String             @id @default(cuid())
  name         String
  email        String             @unique
  passwordHash String             @default("")
  createdAt    DateTime           @default(now())
  sessions     InterviewSession[]
}

model InterviewSession {
  id               String            @id @default(cuid())
  userId           String
  title            String            @default("Interview")
  domain           String
  resumeText       String            @db.Text // legacy name — stores JD
  resume           String?           @db.Text // candidate's resume
  elevenLabsConvId String?
  mode             InterviewMode     @default(TEXT)
  plannedQuestions Int               @default(7)
  status           InterviewStatus   @default(IN_PROGRESS)
  summary          Json?
  completedAt      DateTime?
  createdAt        DateTime          @default(now())
  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  results          InterviewResult[]

  @@index([userId])
}

model InterviewResult {
  id                 String           @id @default(cuid())
  sessionId          String
  order              Int              @default(0)
  question           String           @db.Text
  answer             String           @db.Text
  contentScore       Int
  communicationScore Int
  confidenceScore    Int
  feedback           String           @db.Text
  createdAt          DateTime         @default(now())
  session            InterviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([sessionId, order])
}
```

**Relations**

- `User 1──* InterviewSession` (cascade on user delete)
- `InterviewSession 1──* InterviewResult` (cascade on session delete)
- No other relations. No auth-session table. No resume or JD library. No report card. `summary` is a typed-at-read Json blob.

---

## 2. Every DB write (create / update / delete)

`file:line` — operation — model — purpose.

**User**
- `app/actions/auth.ts:40` — `prisma.user.create` — create user on signup
- `auth.ts:30` — `prisma.user.findUnique` — login credential lookup (read, listed for context)
- `app/actions/auth.ts:33` — `prisma.user.findUnique` — duplicate-email check on signup

**InterviewSession**
- `app/actions/interview.ts:47` — `interviewSession.create` — `startInterviewAction`
- `app/actions/interview.ts:79` — `interviewSession.delete` — cleanup on failed first-question generation (text mode)
- `app/actions/interview.ts:193` — `interviewSession.update` — text-mode final turn: set `status=COMPLETED`, `completedAt`, `summary`
- `app/actions/interview.ts:255` — `interviewSession.update` — `endVoiceCallAction`: set `elevenLabsConvId`
- `app/actions/interview.ts:271` — `interviewSession.update` — `endVoiceCallAction`: set `status=ABANDONED` (zero-turn transcript)
- `app/actions/interview.ts:292` — `interviewSession.update` — `endVoiceCallAction`: set `status=COMPLETED`, `completedAt`
- `app/actions/interview.ts:480` — `interviewSession.update` — `scoreVoiceSessionAction`: write final `summary`
- `app/actions/interview.ts:519` — `interviewSession.update` — `abandonInterviewAction`: set `status=ABANDONED`

**InterviewResult**
- `app/actions/interview.ts:64` — `interviewResult.create` — text-mode first question (placeholder row)
- `app/actions/interview.ts:212` — `interviewResult.create` — text-mode next-question placeholder row
- `app/actions/interview.ts:146` — `interviewResult.update` — text-mode per-turn: write answer + scores + feedback
- `app/actions/interview.ts:415` — `interviewResult.update` — `scoreVoiceSessionAction`: write per-turn scores + feedback
- `app/actions/interview.ts:278` — `interviewResult.deleteMany` — `endVoiceCallAction`: wipe prior placeholder rows
- `app/actions/interview.ts:279` — `interviewResult.createMany` — `endVoiceCallAction`: seed Q/A rows with score=0 placeholders

**Reads of note**
- `interviewSession.findUnique` at `interview.ts:106, 243, 316, 516`; `interview.ts:158` reads results
- `interviewSession.findMany` at `app/dashboard/page.tsx:54` (list user's sessions)
- `interviewSession.findUnique` at `app/dashboard/interview/[id]/page.tsx:72` (detail page)
- `interviewSession.findUnique` at `app/interview/[id]/page.tsx:29` (live page)

---

## 3. Every route / server action

### Auth
- `app/(auth)/login/page.tsx` — renders `<LoginForm />`
- `app/(auth)/signup/page.tsx` — renders `<SignupForm />`
- `app/api/auth/[...nextauth]/route.ts` — re-exports `{ GET, POST }` from `auth.ts`
- `app/actions/auth.ts::signupAction` — zod-validate, check duplicate email, hash pw, create user, `signIn("credentials")`, redirect `/dashboard`
- `app/actions/auth.ts::loginAction` — zod-validate, `signIn("credentials")`, redirect `from || /dashboard`
- `app/actions/auth.ts::signOutAction` — `signOut({ redirectTo: "/" })`
- `proxy.ts` — Next 16 file convention (replaces `middleware.ts`). Redirects unauth users off `/dashboard`, `/interview` to `/login?from=...`. Redirects authed users off `/login`, `/signup` to `/dashboard`.

### Interview setup
- `app/interview/new/page.tsx` — `requireUser`, renders `<NewInterviewForm />`
- `app/interview/new/NewInterviewForm.tsx` — title + JD + resume + `numQuestions` slider + TEXT/VOICE toggle
- `app/actions/interview.ts::startInterviewAction` — zod-validate, `interviewSession.create`; for TEXT pre-generates first Q via `generateInterviewQuestion` and creates placeholder `InterviewResult`; redirects `/interview/[id]`

### Interview runtime
- `app/interview/[id]/page.tsx` — server shell; reads session, branches on mode
- `app/interview/[id]/InterviewRoom.tsx` — client: text-mode Q/A loop, calls `submitAnswerAction`
- `app/interview/[id]/VoiceRoom.tsx` — client: wraps `<ConversationProvider>` around `<VoiceRoomInner>`; `useConversation()` + ElevenLabs WebRTC; `endCall` calls `endVoiceCallAction`
- `app/actions/interview.ts::submitAnswerAction` — text-mode per-turn: `evaluateInterviewAnswer` → update row; if last turn: `generateInterviewSummary` → complete session
- `app/actions/interview.ts::endVoiceCallAction` — fast path: `fetchElevenLabsConversation`, parse Q/A, wipe + seed rows (score=0), mark COMPLETED, return redirect
- `app/actions/interview.ts::scoreVoiceSessionAction` — async path from detail page: concurrency-limited (3) per-turn `evaluateInterviewAnswer` + 1 retry + honest degradation; then `generateInterviewSummary`; idempotent via `session.summary` check
- `app/actions/interview.ts::abandonInterviewAction` — mark `status=ABANDONED` (unused from UI today)
- `app/api/elevenlabs/signed-url/route.ts` — `GET`, auth-gated, returns `{ signedUrl, agentId }` from ElevenLabs signed-url endpoint

### Dashboard
- `app/dashboard/page.tsx` — user-scoped `interviewSession.findMany`, aggregated scores, status badges, `ReadinessCard` + `ScoreTrendChart`
- `app/dashboard/interview/[id]/page.tsx` — single session, parses `summary` Json, renders AutoFinalizer + transcript
- `app/dashboard/interview/[id]/AutoFinalizer.tsx` — client: on mount calls `scoreVoiceSessionAction`, then `router.refresh()`; StrictMode-guarded with `triggeredRef`

### Public
- `app/page.tsx` — landing

---

## 4. ElevenLabs integration

### 4a. Signed URL issuance (server)
- `lib/elevenlabs.ts:12–38` — `getElevenLabsSignedUrl()` hits `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=$AGENT_ID` with `xi-api-key` header. 10s `AbortSignal.timeout`. Returns `{ signedUrl, agentId }`. Requires `convai_write` scope on the API key.
- `app/api/elevenlabs/signed-url/route.ts:8–22` — `GET`, enforces `getCurrentUser()`, proxies the call.

### 4b. Client connection (browser)
- `app/interview/[id]/VoiceRoom.tsx:32–38` — `<VoiceRoom>` wraps `<VoiceRoomInner>` in `<ConversationProvider>`; required because `useConversation` reads from the provider's context.
- `VoiceRoom.tsx:47–65` — `useConversation({ onConnect, onDisconnect, onMessage, onError })`.
- `VoiceRoom.tsx:84–135` — `startCall()`: request mic via `getUserMedia`, fetch signed URL from our API, call `conversation.startSession({ signedUrl, dynamicVariables: { candidate_name, interview_title, planned_questions, jd, resume } })`. `startSession` returns `void` per SDK typedef.
- `VoiceRoom.tsx:72–82` — `useEffect` on `status === "connected"` stashes `conversation.getId()` into `conversationIdRef`. Reactive because (a) `startSession` returns void, (b) id is only defined after the WS handshake.

### 4c. Live transcript capture
- `VoiceRoom.tsx:54–58` — `onMessage` callback pushes each turn into local `messages` state. Used only for the in-call display — not persisted.

### 4d. End-call handling
- `VoiceRoom.tsx:137–186` — `endCall()`: capture id from ref, fire-and-forget `conversation.endSession()`, call `endVoiceCallAction`, redirect on success.
- `app/actions/interview.ts:237–302` — `endVoiceCallAction`: auth + ownership, short-circuit if COMPLETED, persist `elevenLabsConvId`, `fetchElevenLabsConversation`, `parseTurnsIntoQA`, wipe+seed rows, mark COMPLETED.
- `lib/elevenlabs.ts:50–79` — `fetchElevenLabsConversation` polling loop (1.5s interval, 20s outer deadline, 10s per-fetch abort).
- `lib/elevenlabs.ts:83–104` — `parseTurnsIntoQA` pairing logic.

### 4e. Async scoring after redirect
- `app/dashboard/interview/[id]/AutoFinalizer.tsx` — mounted when `session.status === "COMPLETED" && summary === null && answered.length > 0`; calls `scoreVoiceSessionAction(sessionId)`, then `router.refresh()`.

### Agent-side configuration (external)
- System prompt + first message + dynamic variable declarations live in the ElevenLabs dashboard. Setup documented at `docs/elevenlabs-agent-prompt.md`.

---

## 5. Current scoring flow

### 5a. Text mode (per-turn, synchronous)
- Triggered: `submitAnswerAction` — `app/actions/interview.ts:93–226`
- LLM call: `evaluateInterviewAnswer` — `lib/ai.ts:265–304`
- Provider: OpenRouter, model `OPENROUTER_MODEL` env or default `meta-llama/llama-3.1-8b-instruct` (`lib/ai.ts:1–2`)
- Request shape: `callOpenRouter` — `lib/ai.ts:49–98`; `response_format: { type: "json_object" }`, `temperature: 0.3`, 60s abort signal
- Output schema (parser at `lib/ai.ts:155–174`):
  ```json
  { "question": "string",
    "score": { "content": 0-10, "communication": 0-10, "confidence": 0-10 },
    "feedback": "string",
    "nextQuestion": "string (optional)" }
  ```
- Storage: `interviewResult.update` at `interview.ts:146`; if final turn, `generateInterviewSummary` runs and writes to `interviewSession.summary` Json.

### 5b. Voice mode (post-call, async)
- Triggered: `AutoFinalizer` → `scoreVoiceSessionAction` — `app/actions/interview.ts:311–488`
- Per-turn LLM call: `evaluateInterviewAnswer` with `shouldAskNextQuestion: false`
- Concurrency: custom `runWithConcurrency(items, 3, mapper)` at `interview.ts:495–512` — caps parallelism at 3 to avoid OpenRouter rate limits
- Retry: 1 retry with jittered backoff (750–1500 ms) at `interview.ts:375–408`
- Failure handling: per-turn failure becomes `{ contentScore: 0, feedback: "", evaluated: false }`
- Degradation: `successCount < Math.ceil(scored.length / 2)` → skip summary generation, save honest `partial: true` summary
- Storage: per-row `interviewResult.update`; summary Json written to `interviewSession.summary`

### 5c. Summary Json shape written today
```ts
{
  summary: string;
  overallScore: number;     // 0–10
  strengths: string[];
  improvements: string[];
  partial?: boolean;
  successCount?: number;
  totalTurns?: number;
}
```
Parsed defensively at `app/dashboard/interview/[id]/page.tsx:47–62` via `toSummary`.

---

## 6. Dead code / commented blocks / TODOs

- **TODO/FIXME/XXX/HACK**: zero matches across `**/*.{ts,tsx,prisma}`.
- **Commented-out code**: none. Every top-comment found was explanatory prose (see `lib/elevenlabs.ts:53,64`, `VoiceRoom.tsx:52,70,127,141,155,156`, `interview.ts:59,60,78`).
- **Unused export**: `abandonInterviewAction` (`interview.ts:514–524`) is exported but has zero call sites in client components. Candidate for deletion or actual wiring.

---

## 7. Things to know before refactoring

### Naming hazards
- **`InterviewSession.resumeText` stores the JD, not the resume.** The actual resume was added later as `resume String?`. In voice mode wiring: `VoiceRoom` receives `jd={session.resumeText}` (`app/interview/[id]/page.tsx:85`) and `resume={session.resume ?? ""}` (line 86) — the mismatch between field name and value is live coupling. Rename on migration.
- **`InterviewSession.domain` is always the literal string `"JD-based Interview"`** (`interview.ts:51`). Column is required, value is meaningless — drop or repurpose.

### Coupling and subtle hacks
- **`evaluateInterviewAnswer` is dual-purpose.** It both grades an answer and generates the next question (based on `shouldAskNextQuestion`). Text mode uses both outputs; voice mode only uses the grade. Splitting would be cleaner and cheaper for voice.
- **`generateInterviewSummary` silently drops failed turns** (`interview.ts:450` — `.filter((r) => r.evaluated)`). Intentional but not obvious.
- **`summary` Json has grown organically.** Fields `partial`, `successCount`, `totalTurns` were added without schema. Detail page parser does defensive `typeof` checks.
- **AutoFinalizer fires on mount in StrictMode.** Guarded by `triggeredRef.current`; `scoreVoiceSessionAction` is also idempotent via `session.summary` early-return. Two overlapping guarantees — one should go.
- **`VoiceRoom` does not `await conversation.endSession()`.** Fire-and-forget because certain SDK builds hang forever on WS teardown. Load-bearing — don't re-add `await` during refactor.
- **`endVoiceCallAction` deletes and re-inserts transcript rows every call** (`interview.ts:278–290`). Outer idempotency is by `session.status === "COMPLETED"` — coarse.
- **`conversation.startSession` returns `void`**; the conversation id is available only via `getId()` after status flips to `"connected"`. The reactive ref-capture pattern (`VoiceRoom.tsx:72–82`) is load-bearing.

### Auth caveats
- **JWT session strategy** — `auth.ts:14`. No DB session table; cannot revoke sessions server-side. Fine for MVP, not ideal for production. Switching to the proposed `AuthSession` table invalidates all outstanding tokens on switchover.
- `proxy.ts` uses the Next 16 file convention (not `middleware.ts` — that's a no-op in Next 16).

### Env vars assumed present
- `DATABASE_URL`, `DIRECT_DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (optional), `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `ELEVENLABS_API_KEY` (needs `convai_write`), `ELEVENLABS_AGENT_ID`.

### Prisma specifics
- Generator output at `lib/generated/prisma` (`schema.prisma:2–3`). After any schema change, `prisma generate` must run. `postinstall` handles fresh clones. The **running dev server holds the old module graph** until restarted — after `prisma migrate dev` always restart `npm run dev` or server actions throw `PrismaClientValidationError`.
- `InterviewSession.summary` and future Json fields use `Prisma.DbNull` / `Prisma.JsonNull` when setting to null — not JS `null`.

### Config / infra
- `next.config.ts` is empty. No `cacheComponents: true` — pre-PPR path, fine for per-user dynamic data.
- `build` script is `prisma generate && next build` (`package.json:7`) — `next build` alone fails on a fresh clone.
- `proxy.ts`'s matcher excludes `/api/*` — intentional. Server actions are posted to their host page route, not `/api/*`, so they still run through the matcher.

### Out-of-scope signals worth capturing
- No file upload pipeline. `Resume.fileUrl` etc. from the proposed schema require picking a blob provider first.
- No observability: no LLM call log, no request logger, no Sentry. Silent failures are the current default.
- No tests.
- No rate limiting on any route.
- No email verification; `passwordHash` has an empty-string default that is a footgun for any legacy row.
