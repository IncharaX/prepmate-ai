# Phase 7 Plan — Shareable report links + polish

_Pre-code planning doc. Read `docs/AUDIT.md` §6 (dead code), `docs/PHASE-6-PLAN.md` (ReportCard + EvaluationPoller), `prisma/schema.prisma` `ReportShareLink` model._

---

## 0. Ground rules

| API / library | Source to re-check | Why |
| --- | --- | --- |
| Node `crypto.randomBytes` + base64url | built-in | Token generation. `randomBytes(24).toString("base64url")` = 32 URL-safe chars, 144 bits of entropy. |
| Prisma 7 increment + update race | existing singleton | `update({ data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } })` is atomic enough for our view counter — no row-level locking required. |
| Next.js 16 `proxy.ts` matcher | `proxy.ts:29-31` | `/report/*` must NOT redirect unauth users to login. Current matcher excludes `/api/*` + static; `/report/*` would fall into the protected bucket unless we explicitly exclude it. Add `/report/` to the "don't gate" list. |
| `robots` meta for unlisted pages | Next.js Metadata API | Add `robots: { index: false, follow: false }` to the public report page metadata so Google doesn't crawl individual reports. |
| R2 presigned GET with 1h TTL | `lib/storage.ts::getSignedDownloadUrl(key, ttlSeconds)` | Already exists; pass `3600`. No new helper needed. |

---

## 1. What changes vs today

**Today:**
- No way to share a report externally. The detail page at `/dashboard/interview/[id]` is auth-gated.
- Detail page's `<EvaluationPoller>` handles `completed_partial` retries, but a pure `failed` session (`session.status === "failed"`, no ReportCard) renders nothing because the guard is `completed && !card && candidateTurns.length > 0` (line 103). Dead-end.
- `session.fullAudioUrl` exists in the schema but is never populated and never rendered. No audio player anywhere.
- Dashboard row tertiary text is the avg score. No recommendation badge.
- Dashboard empty state shows only one CTA ("Start your first interview"). No pointer to the Library.
- Rubric version is displayed as plain inline text under the recommendation strip. Works, no styling.
- Several dead files from earlier phases that the Phase 6 cleanup didn't touch (see §7).

**After Phase 7:**
- Owner detail page gets a **Share** card: create link, copy, revoke. Link URL is `/${NEXT_PUBLIC_APP_URL}/report/${token}`.
- Public `/report/[token]` route renders a trimmed, read-only version. No auth. Indexing disabled.
- Detail page shows an audio player at the top of the transcript **when** `session.fullAudioUrl` is populated. (Populating it remotely is out of scope — see §5.)
- `failed` sessions render the retry poller the same way `completed_partial` does.
- Rubric version + evaluator model become a small monospace pill for visual identity.
- Dashboard list shows color-coded recommendation badges on completed sessions; empty state adds a library CTA.
- `lib/ai.ts`, `components/interview/FeedbackCard.tsx`, and `abandonInterviewAction` are gone.

---

## 2. Scope boundaries

**This phase does NOT:**
- Fetch ElevenLabs full-audio, upload to R2, and populate `session.fullAudioUrl`. That's a separate ~1h subphase with its own R2 cost decision. The player WILL work the moment that key lands — we just don't write it this phase. Call it out in the final report.
- Add an expiry date-picker UI. Links live until revoked; `expiresAt` column stays for future UX.
- Add password protection / access codes on share links. MVP: knowing the URL = reading the report.
- Add share-link analytics beyond the existing `viewCount` + `lastViewedAt` columns. No IP logging, no referrer capture, no funnel.
- Turn the public report into an embeddable/OG-card widget. No `<meta property="og:image">` snapshot this phase.
- Rebuild text mode.
- Migrate `InterviewSession.summary` column out of the schema.

---

## 3. Open decisions (recommendation in **bold**)

1. **Token generation**: `crypto.randomBytes(24).toString("base64url")` → 32 URL-safe chars, 192 bits of entropy (oversized on purpose — cheap to generate, unguessable). DB has `token @unique`; on collision retry once. **→ Ship.**
2. **Default expiry**: `expiresAt = null` (no expiry). Owner revokes manually. Column exists so we can add a picker later. **→ None for MVP.**
3. **Multiple share links per report**: schema allows many. **→ MVP shows the most recent non-revoked one.** "Revoke + create" gets you a fresh URL. No multi-link management UI.
4. **Public view contents**: show recommendation, overall score, rubric bars, summary, strengths/gaps (with quotes), JD-fit matrix, per-question transcript (collapsible, default closed). **Hide**: candidate first-name greeting header, audio player, ElevenLabs IDs, "Start another" CTA, sidebar shell. Show: "Powered by PrepMate AI" footer, interview title (JD label, not candidate name).
5. **Bot-indexing**: `metadata.robots = { index: false, follow: false }` on the public page. **→ Ship.**
6. **`proxy.ts` matcher**: current matcher treats everything outside `/api`, static, and image files as candidate protected routes. I'll audit it — `/report/[token]` falls under the general bucket, so I need to explicitly bypass auth for it in the proxy logic or add it to the matcher exclusion. **→ Add `/report` to the protected-route exclusion list in `proxy.ts`.**
7. **Retry for `failed` status**: reuse the existing `<EvaluationPoller>` — pass `initialError = session.errorMessage` so it opens in error-state with a retry button. **→ Yes, reuse. Just widen the parent page's "show poller" guard.**
8. **Audio player UX**: native `<audio controls preload="none">` with a small label above: "Full call audio · 18 min". Signed URL regenerated on every page load (1h TTL is plenty for a session). **→ Ship. No custom player.**
9. **Audio player on public view**: **hide**. Audio is a privacy hazard (voices, names mentioned in conversation, etc.). Candidate might not want to broadcast their voice. Revisit if someone asks.
10. **Recommendation colors on dashboard list**: map to existing tokens —
    - `strong_yes` → filled `primary` pill (amber)
    - `yes` → `accent` pill
    - `maybe` → `muted` pill
    - `no` → `destructive/15 + destructive text` pill
    - `strong_no` → filled `destructive` pill
    Keep the avg-score number as secondary micro-text underneath. **→ Ship.**
11. **Extract shared badge components**: `RecommendationBadge` already lives inside `app/dashboard/interview/[id]/page.tsx`. Move to `components/report/RecommendationBadge.tsx` so the dashboard list + public report + owner detail all use the same one. Same for `FitStatusBadge`. **→ Extract.**
12. **Dead code deletion policy**: grep before delete, confirm zero imports, then remove in one commit. If anything surprises, revert — don't soldier on.

---

## 4. Share link contract

### Actions

`app/actions/share.ts`:

```ts
createShareLinkAction(reportCardId): Promise<
  | { ok: true; token: string; url: string }
  | { ok: false; message: string }
>

revokeShareLinkAction(shareLinkId): Promise<{ ok: boolean }>

// For owner detail page — fetch existing link (most recent non-revoked) to render
// current state without a client-side fetch.
getCurrentShareLink(reportCardId): Promise<
  | { id, token, url, viewCount, lastViewedAt, createdAt }
  | null
>
```

All three:
- `requireUser()` + ownership check through `ReportCard → InterviewSession → userId`
- `createShareLinkAction` generates token via `crypto.randomBytes(24).toString("base64url")`, inserts a new `ReportShareLink`. On `P2002` unique-violation (astronomically unlikely), retry once with a fresh token.
- `revokeShareLinkAction` sets `revokedAt = now()` (does not delete; we want view-count history).
- `getCurrentShareLink` finds the most recent row with `revokedAt IS NULL`.

### Public route `/report/[token]`

`app/report/[token]/page.tsx` (server component, no auth):

1. Load `ReportShareLink` where `token = params.token AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`. `include: reportCard.include.questionEvaluations + jdFitItems + session.jobDescription(label only)`.
2. If not found → `notFound()`.
3. `update({ viewCount: { increment: 1 }, lastViewedAt: new Date() })`. Fire-and-forget — don't block render on the update.
4. Export `metadata` with `robots: { index: false, follow: false }` + `title: "Interview report"`.
5. Render a stripped-down version of the owner detail page composition.

### `proxy.ts` change

Currently the matcher is broad. Add `/report` to the `PROTECTED_PREFIXES`'s **opposite** — i.e., ensure the auth gate doesn't fire on `/report/*`. Simplest: add `/report` to the "public" prefix list before the protected check, OR change the matcher regex to exclude `/report`.

Cleanest: keep the matcher as-is, add an explicit short-circuit inside `proxy(request)`:

```ts
if (pathname.startsWith("/report/")) return NextResponse.next();
```

One line, obvious intent.

---

## 5. Audio playback

`app/dashboard/interview/[id]/page.tsx`:

- At the top of the per-question transcript section, conditionally render an audio card when `session.fullAudioUrl` is non-null.
- Page-level helper (server-side): `const audioUrl = session.fullAudioUrl ? await getSignedDownloadUrl(session.fullAudioUrl, 3600) : null;`
- Render:
  ```tsx
  {audioUrl ? (
    <Card>
      <CardContent className="grid gap-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Full call audio · {formatDuration(session.callDurationSeconds) ?? "—"}
        </p>
        <audio controls preload="none" src={audioUrl} className="w-full" />
      </CardContent>
    </Card>
  ) : null}
  ```
- Public view: audio is NOT rendered. Period.

**Populating `fullAudioUrl` is out of scope.** Today the value is always null — the player literally never shows. When the fetch-and-store subphase ships (future: `GET /v1/convai/conversations/{id}/audio` → R2 upload → key persist), this UI lights up automatically.

---

## 6. Rubric version label + retry + dashboard polish

### Rubric version — owner detail page

Today (line ~178): `"Rubric {card.rubricVersion} · {card.evaluatorModel}"` plain text next to the recommendation badge. Change to a small monospace pill:

```tsx
<span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
  <span>Rubric {card.rubricVersion}</span>
  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
  <span>{card.evaluatorModel}</span>
</span>
```

Also shown on the public view (same style).

### Retry button for `failed` status

`app/dashboard/interview/[id]/page.tsx` — widen the poller guard:

```diff
- const showPoller = completed && !card && candidateTurns.length > 0;
+ const showPoller =
+   (completed || session.status === "failed") && !card && candidateTurns.length > 0;
```

`<EvaluationPoller>` already handles the error state via `initialError={pollerError}`; include `session.errorMessage` for `failed` too. Minimal change to the Poller itself — maybe just a copy tweak ("Evaluation failed — retry when you're ready").

### Dashboard list — recommendation badge

`app/dashboard/page.tsx`:

- Extend the Prisma query with `reportCards: { where: { isCurrent: true }, select: { recommendation: true, overallScore: true }, take: 1 }`.
- Summary shape gets a new `recommendation?: RecommendationValue` + `overallScore?: number`.
- Render: for completed sessions with a report, show the `<RecommendationBadge>` (extracted component) instead of the current score pill. Score becomes small caption.
- For sessions without a report (pending/in_progress/completed but still scoring), show the existing avg as-is.

### Dashboard empty state

`app/dashboard/page.tsx`'s `<EmptyState>`:

- Existing primary CTA: "Start your first interview" → `/interview/new`.
- Add secondary outline button: `"Or browse your library"` → `/dashboard/library`. (Library is likely empty on first load — lands them on the library page's own empty state with an Upload button. Fine chain.)

---

## 7. Dead code — grep-verified candidates

Ran `grep -rn …` across `app/` + `lib/` + `components/`:

| Path / name | Grep result | Action |
| --- | --- | --- |
| `lib/ai.ts` (`generateInterviewQuestion`, `evaluateInterviewAnswer`, `generateInterviewSummary`, `AIResponseError`, all types) | Only self-references. Zero importers. | **Delete whole file.** |
| `components/interview/FeedbackCard.tsx` | Self-references only. Zero importers. | **Delete file.** |
| `components/interview/QuestionCard.tsx` | Still imported by `app/interview/[id]/InterviewRoom.tsx:9` which is the text-mode stub. Reachable via `/interview/[id]` with `mode === "text"` (renders "text mode offline" placeholder). | **Keep.** Rebuild target when text mode returns. |
| `app/interview/[id]/InterviewRoom.tsx` | Rendered by `/interview/[id]/page.tsx:119` when mode is "text". Stub placeholder. | **Keep.** Same reason. |
| `app/actions/interview.ts::abandonInterviewAction` | Exported, zero callers in `app/`, `lib/`, `components/`. Audit §6 originally flagged this; still unused. | **Delete function + any type export tied to it.** |
| `app/actions/evaluate.ts::OverallReportType` | I shipped a defensive re-export in Phase 6 (comment says "safe to remove once grep is clean"). Grep clean. | **Delete re-export.** |
| `InterviewSession.summary` Json column | Not code, schema. Still in DB. Post-Phase 6 nothing writes to it; detail page reads only from `ReportCard`. | **Keep.** Dropping a column is a migration + ops step that doesn't belong in Phase 7. Mark with `// deprecated` comment in the schema in this phase as a paper trail.

I'll re-run the greps immediately before each delete (not just once up front) — hot reloads or my own future edits might have added a caller.

---

## 8. Files to CREATE / MODIFY / DELETE

### CREATE

| Path | Purpose |
| --- | --- |
| `app/actions/share.ts` | `createShareLinkAction` + `revokeShareLinkAction` + `getCurrentShareLink` + `getAudioSignedUrl` (tiny wrapper returning 1h URL for the owner detail page — colocated so share/audio concerns live together). |
| `app/report/[token]/page.tsx` | Public report page. Server component. |
| `app/report/[token]/PublicReportTranscript.tsx` | Client component for the collapsible transcript disclosure. |
| `app/dashboard/interview/[id]/ShareCard.tsx` | Client card: "Create link" → "Copy URL / View count / Revoke". Imports the share actions. |
| `components/report/RecommendationBadge.tsx` | Pure component, pulls from the five `Recommendation` enum values → colored pill. |
| `components/report/FitStatusBadge.tsx` | Pure component, pulls from the four `FitStatus` enum values → icon + label. |

### MODIFY

| Path | Change |
| --- | --- |
| `app/dashboard/interview/[id]/page.tsx` | Widen `showPoller` to cover `failed`. Replace in-file `RecommendationBadge` / `FitStatusBadge` with imports. Render `<ShareCard>` below the recommendation strip. Render audio card above the transcript section when `fullAudioUrl` exists. Small rubric version pill restyle. |
| `app/dashboard/interview/[id]/EvaluationPoller.tsx` | Copy tweak for `initialError` state so "Evaluation failed" reads right. (Behavior already correct.) |
| `app/dashboard/page.tsx` | Extend query to include current ReportCard's `recommendation` + `overallScore`. Pass to `<SessionRow>`. Swap the avg-score pill for `<RecommendationBadge>` when a report exists. Extend `<EmptyState>` with the secondary Library CTA. |
| `proxy.ts` | Short-circuit auth for `/report/*`. |
| `prisma/schema.prisma` | One-line comment on `InterviewSession.summary` marking it deprecated. No migration. |

### DELETE

| Path | Reason |
| --- | --- |
| `lib/ai.ts` | Whole file unused post-Phase 6. |
| `components/interview/FeedbackCard.tsx` | Unused. |
| `app/actions/interview.ts::abandonInterviewAction` | Unused export. |
| `app/actions/evaluate.ts::OverallReportType` re-export | Scaffolding from Phase 6, grep-clean. |

---

## 9. Public view — composition (what renders on `/report/[token]`)

```
┌───────────────────────────────────────────────────────────────┐
│  <no sidebar, no dashboard shell>                              │
│                                                                │
│  PrepMate AI  — Interview report                               │
│                                                                │
│  [Recommendation badge]  Overall  72 / 100                     │
│  Rubric v1 · claude-sonnet-4.5                                 │
│  "Solid mid-level screen. Strong on the React performance…"    │
│                                                                │
│  ── Rubric breakdown ──                                        │
│  Communication          █████████░░  78                        │
│  JD Relevance           ██████░░░░░  62                        │
│  Experience Depth       ████████░░░  72                        │
│  Specificity            ██████████░  84                        │
│  Confidence             ████████░░░  70                        │
│                                                                │
│  ── Summary ──                                                 │
│  (paragraph from card.summary)                                 │
│                                                                │
│  ── What worked (card.strengths) ──                            │
│  ── What to sharpen (card.gaps) ──                             │
│                                                                │
│  ── JD fit ──                                                  │
│  [Table with met/partial/unclear/not_shown]                    │
│                                                                │
│  ▸ Show transcript (hidden by default, click to expand)        │
│                                                                │
│  —— Powered by PrepMate AI · yourdomain.com ——                 │
└───────────────────────────────────────────────────────────────┘
```

Styling mirrors the owner detail page (same rubric bars, same strengths/gaps cards, same JD-fit matrix) so the "brand" feels consistent. Extracted badge components (§11) ensure no duplication.

---

## 10. Verification plan

1. `npm run build` + `npm run lint` clean. Route manifest shows `/report/[token]`.
2. Create a voice interview; when the report lands, detail page now shows the **Share** card with a "Create shareable link" button.
3. Click it → toast shows success + the URL is copied to clipboard (via `navigator.clipboard.writeText`). DB: `report_share_links` has a new row with a 32-char base64url token, `revoked_at = null`, `view_count = 0`.
4. Open the URL in an incognito window. Public report renders: recommendation badge, score, rubric bars, summary, strengths/gaps, JD-fit matrix. Transcript disclosure is closed by default. No "Start another" CTA, no candidate name, "Powered by PrepMate AI" footer. Incognito refresh increments `view_count` and updates `lastViewedAt`.
5. Curl `HEAD /report/<token>` → 200 with `x-robots-tag: noindex, nofollow` (via metadata).
6. Back on the owner detail page, click **Revoke**. DB: `revoked_at` set. Incognito refresh → 404.
7. Force a `failed` session (bogus `OPENROUTER_EVALUATOR_MODEL`, finish a call). Detail page shows the EvaluationPoller in error state with a **Retry** button. Retry with fixed env → report renders.
8. Dashboard empty state: new user sees two CTAs (interview + library).
9. Dashboard list: a completed session shows the recommendation badge in color; an in-progress one shows the status badge instead.
10. Dead-code grep is clean: `grep -rn "generateInterviewQuestion\|evaluateInterviewAnswer\|generateInterviewSummary\|FeedbackCard\|abandonInterviewAction" app/ lib/ components/` returns zero hits.
11. Manually set one session's `full_audio_url` to `"resumes/<userId>/dummy.pdf"` in Studio (smoke-test — we don't care if it's audio; the player just needs a key). Detail page renders the audio card with a 1h-signed URL. Leave Studio → unset it → card disappears.

---

## 11. Execution order

1. Extract `components/report/RecommendationBadge.tsx` + `components/report/FitStatusBadge.tsx` from the existing owner detail page. Update the detail page to import them. Confirm render unchanged.
2. `app/actions/share.ts` — `createShareLinkAction`, `revokeShareLinkAction`, `getCurrentShareLink`, `getAudioSignedUrl`.
3. `app/dashboard/interview/[id]/ShareCard.tsx` — owner-side UI.
4. Wire `ShareCard` + audio card + rubric pill tweak + `failed` poller into the owner detail page.
5. `proxy.ts` — short-circuit `/report`.
6. `app/report/[token]/page.tsx` + `PublicReportTranscript.tsx` — public page.
7. Dashboard updates: extend query, pass recommendation to `SessionRow`, extend empty state.
8. Dead-code sweep: re-run grep, delete `lib/ai.ts`, delete `components/interview/FeedbackCard.tsx`, delete `abandonInterviewAction`, delete the defensive `OverallReportType` re-export.
9. `npx tsc --noEmit` + `npm run lint` + `npm run build`.
10. Manual walkthrough per §10.
11. Report with: what shipped, what's out of scope (audio fetch + expiry UI + password protect), what's untouched but still stubbed (text mode).

---

## 12. Stop contract

No code until approved. When you say go, I'll execute steps 1–10 in order and deliver the report. Expect one commit-worth of work, build + lint clean.
