# Phase 3 Plan — Per-interview dynamic variables + status lifecycle

_Pre-code planning doc. Read `docs/AUDIT.md` §4 (ElevenLabs integration) and `docs/PHASE-2-PLAN.md` §0 (ground rules) for baseline._

---

## 0. Ground rules

Before touching anything I re-check the canonical sources:

| Library / API | Where to check | Why |
| --- | --- | --- |
| `@elevenlabs/react` `conversation.startSession` | `node_modules/@elevenlabs/react/dist/conversation/useConversation.d.ts` + `types.d.ts` | Confirm shape of `dynamicVariables`, whether values must be strings or can be numbers, whether `startSession` accepts signedUrl + agentOverrides + dynamicVariables in the same call. (Our audit confirmed `HookOptions` = `Partial<SessionConfig & ...>`.) |
| ElevenLabs Conversational AI "Dynamic Variables" | <https://elevenlabs.io/docs/conversational-ai/customization/personalization/dynamic-variables> | Confirm placeholder syntax (`{{var_name}}`), permitted types, reserved names. Only string / number / boolean primitives per docs. |
| Next.js 16 `POST` route handlers | `node_modules/next/dist/docs/01-app/01-getting-started/08-route-handlers.md` | Confirm JSON body parsing via `request.json()` and `runtime = "nodejs"` conventions. |
| Prisma 7 soft-delete extension | `lib/prisma.ts` (already written Phase 2) | `findFirst` auto-filters soft-deleted; `findUnique` does not. Use `findFirst` for ownership gate. |

No code until each of these has been re-read during the touching step; specifically, I'll grep the installed `useConversation.d.ts` again to verify the exact `startSession` option key (`dynamicVariables` camelCase, not `dynamic_variables`) before changing the route shape.

---

## 1. What we're actually changing (and why)

Today:
- `/api/elevenlabs/signed-url` (GET) returns `{ signedUrl, agentId }`. No session context.
- `/interview/[id]/page.tsx:86–91` reads the session + JD + resume server-side and **passes full JD/resume strings as client props** to `<VoiceRoom>` (`title`, `candidateName`, `plannedQuestions`, `jd`, `resume`).
- `VoiceRoom.tsx:117–126` composes `dynamicVariables` from those props and passes them to `conversation.startSession` on the client.
- Conversation ID is captured reactively (`VoiceRoom.tsx:72–82`) but only **persisted at call end** inside `endVoiceCallAction` (`app/actions/interview.ts:255–258`).
- Status today: `ready` on creation → `completed` on end. `in_progress` exists in the enum but is never set for voice sessions.

Issues this phase fixes:
1. **Full JD/resume text round-trips through the browser.** On a big JD + resume that's 20+ KB of HTML payload per page load. Also un-truncatable — the client sends whatever the server handed over.
2. **No truncation.** ElevenLabs has agent prompt-size limits; a huge resume can push the final assembled prompt past what the model can chew.
3. **No ownership verification at the signed-URL issuance moment.** Today any authenticated user could mint a signed URL (we only gate `getCurrentUser()`). We should also gate `session.userId === user.id` and that the session is in a valid state.
4. **`conversationId` only lands on the session at call end.** If the call dies abruptly (tab close, crash) we lose the link between the session and the ElevenLabs conversation — can't fetch the transcript later.
5. **Status lifecycle is incomplete.** `in_progress` is dead code today for voice.

---

## 2. Scope boundaries

**This phase does NOT:**
- Change Maya's system prompt in the ElevenLabs dashboard. The user manages that in Cloudflare… I mean ElevenLabs. I'll document the new variable names the prompt should reference, and let the user update the prompt there.
- Add a `pending` transition for anything. The enum has `pending` but Phase 5 (LLM-generated prep) is where `pending → ready` becomes meaningful. For now, fresh voice sessions still boot straight to `ready`.
- Store transcript turns anywhere new. Phase 4 handles transcripts / `TranscriptTurn`.
- Rewrite `endVoiceCallAction` scoring paths. Still stubbed.
- Generate LLM prep data (`prep_data` / `prep_model` / `prep_completed_at` stay null). Phase 5.

---

## 3. Open decisions (recommendation in bold)

1. **HTTP method for `/api/elevenlabs/signed-url`**: GET with query param `?sessionId=...` vs POST with `{ sessionId }` body. **→ Change to POST.** Reasons: (a) issuing a signed URL + reading per-session context is semantically a "create ephemeral token for this session" action, not an idempotent read; (b) keeps the sessionId out of access logs / referer headers / browser history; (c) no extra complexity on the client. Breaking change for the client but only one caller to update (`VoiceRoom.tsx:102`).
2. **Truncation strategy**: hard-cut at exactly 3000 chars vs word-boundary cut. **→ Word boundary.** Cut at the last whitespace ≤3000; fallback to hard cut if no whitespace. Append `"… [truncated]"` when we cut. Keeps the prompt legible.
3. **Dynamic variable value types**: ElevenLabs docs say primitives — string / number / boolean. **→ Pass everything as strings** (including `planned_questions`) for stability. The agent prompt will interpolate as text anyway.
4. **`candidate_name` fallback chain**: `user.name?.trim()?.split(" ")[0] || emailPrefix(user.email) || "there"`. Email prefix = everything before `@`. Keeps the greeting from ever being empty.
5. **`interview_title` fallback**: `jobDescription.label?.trim() || "HR Screen"`. The JD dialog guarantees a non-empty label, but belt-and-suspenders.
6. **Status gate on signed URL issuance**: reject when status is `completed` / `completed_partial` / `abandoned` / `failed`. Reject when `mode !== "voice"`. Accept `ready` and `in_progress` (the latter allows "re-issuing" on a page refresh mid-call — the worst case is the client reconnects; not ideal but not catastrophic; we can tighten later).
7. **When do we transition `ready → in_progress`?** On the `useEffect(() => { if (status === "connected") ... })` hook firing inside VoiceRoom (not on page load, not on "Start call" click — only once the WebRTC connection is actually live). That's also the earliest moment we have a real `conversation.getId()`.
8. **Idempotency of `markInterviewStartedAction`**: If called twice (StrictMode, reconnect), the second call is a no-op. Check `status !== "in_progress"` before writing; always safe to update `elevenlabsConversationId` (overwriting with the same value is a no-op).
9. **Old doc `docs/elevenlabs-agent-prompt.md`**: delete it and replace with `docs/elevenlabs-agent-setup.md` (user-requested path). The prompt content stays, updated with the new dynamic-variable names. One canonical guide > two overlapping ones.

---

## 4. Files to MODIFY

| Path | Change |
| --- | --- |
| `app/api/elevenlabs/signed-url/route.ts` | Rewrite as POST. Body: `{ sessionId: string }` (zod-validated UUID). Flow: `requireUser` → `findFirst` session with `include: { resume: true, jobDescription: true }` and `userId` filter → gate on `mode === "voice"` and status ∈ {ready, in_progress} → compose dynamic variables with truncation → `getElevenLabsSignedUrl()` → return `{ signedUrl, dynamicVariables }`. 400 on validation, 403 on ownership, 409 on wrong mode/status. |
| `app/interview/[id]/VoiceRoom.tsx` | Drop props: `title`, `candidateName`, `plannedQuestions`, `jd`, `resume`. Keep `sessionId`. `startCall()` POSTs to `/api/elevenlabs/signed-url` with `{ sessionId }`, takes `{ signedUrl, dynamicVariables }` from the response, passes both to `conversation.startSession`. New effect: when `status === "connected"` and `conversationIdRef.current` is set, call `markInterviewStartedAction({ sessionId, conversationId })` **once** (guarded by a separate ref so React 19 StrictMode double-fire is safe). |
| `app/interview/[id]/page.tsx` | Stop passing `title` / `candidateName` / `plannedQuestions` / `jd` / `resume` to `<VoiceRoom>`. The page's header still uses `title` for display. `candidateName` / `plannedQuestions` are no longer needed here at all. |
| `app/actions/interview.ts` | Add `markInterviewStartedAction({ sessionId, conversationId })`. Auth + ownership; bail silently if session is already `in_progress` or past it (returns `{ ok: true }`); otherwise update `status = in_progress`, `callStartedAt = new Date()`, `elevenlabsConversationId = <arg>`. Revalidate the detail path. Idempotent. |
| `lib/elevenlabs.ts` | Add a small `truncateAtWord(text, max)` helper exported from here (only spot we use it). |

## 5. Files to CREATE

| Path | Purpose |
| --- | --- |
| `docs/elevenlabs-agent-setup.md` | New canonical setup guide. Documents: (a) the five dynamic variables we pass (`candidate_name`, `interview_title`, `planned_questions`, `jd`, `resume`) with example placeholder usage in the prompt; (b) how to create the agent in the dashboard; (c) voice / first-message recommendation; (d) which scopes the API key needs (`convai_write` — per Phase 1 findings); (e) how to point `ELEVENLABS_AGENT_ID` at it. |

## 6. Files to DELETE

| Path | Why |
| --- | --- |
| `docs/elevenlabs-agent-prompt.md` | Superseded by `docs/elevenlabs-agent-setup.md`. No point shipping two overlapping prompt guides. |

---

## 7. Everything affected by the signed-URL method/shape change

Short list since the surface is narrow:

1. **`app/api/elevenlabs/signed-url/route.ts`** — implementation rewrite (GET → POST; returns dynamicVariables).
2. **`app/interview/[id]/VoiceRoom.tsx`** — the one and only caller. Fetch call changes from GET to POST with JSON body.
3. **`app/interview/[id]/page.tsx`** — fewer props to `<VoiceRoom>`. No behavior change otherwise.
4. **`endVoiceCallAction` (`app/actions/interview.ts:237`)** — already writes `elevenlabsConversationId` defensively; that write becomes redundant (id will already be set at call-start now), but I'll leave it as a belt-and-suspenders safety net. No logic change here.
5. **Nothing else.** Text mode, dashboard, detail page, scoring — all unchanged.

---

## 8. Contract summary for the new signed-URL endpoint

```
POST /api/elevenlabs/signed-url
Auth:   session cookie (requireUser)
Body:   { sessionId: string }   // UUID

Success 200:
{
  signedUrl: string,                  // one-shot URL for ElevenLabs WebRTC
  dynamicVariables: {
    candidate_name: string,           // "Alex" (first name) | email prefix | "there"
    interview_title: string,          // jd.label | "HR Screen"
    planned_questions: string,        // "7" (stringified int)
    jd: string,                       // truncated to ≤3000 chars, word-boundary
    resume: string                    // truncated to ≤3000 chars, word-boundary
  }
}

Errors:
400   { error: "Invalid sessionId." }               zod failure
401   { error: "Unauthorized" }                     no session
404   { error: "Interview not found." }             owner mismatch or missing
409   { error: "Voice mode only." }                 session.mode !== "voice"
409   { error: "Interview already ended." }         status completed/abandoned/failed
500   { error: "..." }                              R2 / signed-URL service down
```

## 9. Session lifecycle (post-Phase 3)

```
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │   pending   (reserved for Phase 5: LLM prep in flight)       │
 │       │                                                      │
 │       ▼                                                      │
 │   ready     (session created; ready to call)                 │
 │       │                                                      │
 │       │   VoiceRoom status → "connected"                     │
 │       │   ↓ markInterviewStartedAction                       │
 │       ▼                                                      │
 │   in_progress  (callStartedAt set, elevenlabsConvId set)     │
 │       │                                                      │
 │       │   "End call" click                                   │
 │       │   ↓ endVoiceCallAction                               │
 │       ▼                                                      │
 │   completed    (callEndedAt set; Phase 4 stores transcript,  │
 │                 Phase 6 writes ReportCard)                   │
 │                                                              │
 │   completed_partial / failed / abandoned — Phase 6 handles   │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

---

## 10. Agent-prompt impact (user must do this manually in ElevenLabs)

After this phase lands, the Maya prompt in the ElevenLabs dashboard should reference the exact placeholder names:
`{{candidate_name}}`, `{{interview_title}}`, `{{planned_questions}}`, `{{jd}}`, `{{resume}}`.

The new `docs/elevenlabs-agent-setup.md` will contain a paste-ready prompt template using these placeholders. I will not touch the dashboard myself — it's the user's to update. I'll flag in the final report that this manual step is required for the variables to actually bind into the conversation.

---

## 11. Verification plan

1. `npm run build` + `npm run lint` clean.
2. `curl -X POST http://localhost:3000/api/elevenlabs/signed-url -H "Content-Type: application/json" -d '{"sessionId":"<uuid>"}' -b <session-cookie>` → returns `{ signedUrl, dynamicVariables }` with the five expected keys, `jd` and `resume` ≤ 3000 chars.
3. Start a voice call from `/interview/[id]`. Devtools → Network tab shows POST /api/elevenlabs/signed-url, response body contains dynamicVariables. Call connects.
4. Within 1–2 seconds of call connecting, DB row shows `status = "in_progress"`, `call_started_at ≠ null`, `elevenlabs_conversation_id` set.
5. End the call. DB row shows `status = "completed"`, `call_ended_at ≠ null`. `elevenlabs_conversation_id` still present (should equal the one set at start).
6. Attempt POST with a `sessionId` belonging to another user → 404.
7. Attempt POST with a completed session → 409.
8. Upload a JD longer than 3000 chars → confirm the response's `dynamicVariables.jd` is truncated with `"… [truncated]"` suffix and still valid UTF-8.

---

## 12. Execution order (once approved)

1. `lib/elevenlabs.ts` — add `truncateAtWord` helper (pure function, tiny, written first so the route can import).
2. `app/actions/interview.ts` — add `markInterviewStartedAction`.
3. `app/api/elevenlabs/signed-url/route.ts` — rewrite.
4. `app/interview/[id]/VoiceRoom.tsx` — rewire the fetch + add the started-action trigger.
5. `app/interview/[id]/page.tsx` — drop dead props.
6. `docs/elevenlabs-agent-setup.md` — create.
7. `docs/elevenlabs-agent-prompt.md` — delete.
8. `npm run build` + lint.
9. Manual smoke test against the running dev server.
10. Report.

Stop. No code until you've read and approved this. When you say go, I'll start at step 1.
