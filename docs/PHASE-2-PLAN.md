# Phase 2 Plan — Resume + JobDescription library

_Pre-code planning doc. Read `docs/AUDIT.md` and `prisma/schema.prisma` for baseline. Nothing in this plan alters scoring, voice runtime, auth, or the Prisma schema — the schema already carries `Resume` / `JobDescription` tables; Phase 2 just wires the rest of the stack to them._

---

## 0. Ground rules

Before implementation, each library I touch gets its docs checked against the pinned version. Specifically:

| Library | New in this phase | Docs to check |
| --- | --- | --- |
| `@aws-sdk/client-s3` | yes (new dep) | official docs + `node_modules/@aws-sdk/client-s3/dist-types/**/*.d.ts` |
| `@aws-sdk/s3-request-presigner` | yes (new dep) | official docs + typings |
| `pdf-parse` | yes (new dep) | npm readme — note the well-known "requires the deep import to skip the test-pdf side effect": `import pdfParse from "pdf-parse/lib/pdf-parse.js"` |
| `@types/pdf-parse` | yes (dev dep) | existing typings |
| Prisma 7 soft-delete extension | existing | `lib/prisma.ts` — `findUnique` is NOT auto-filtered; use `findFirst` for ownership checks on soft-deletable models |

Cloudflare R2 is S3-compatible; using `@aws-sdk/client-s3` with a custom `endpoint` is the canonical path (I'll verify the current S3 SDK's `PutObjectCommand` surface before writing).

---

## 1. Scope boundaries (what this phase will NOT do)

- No scoring changes. `submitAnswerAction` / `scoreVoiceSessionAction` stay stubs. ReportCard / QuestionEvaluation / JdFitItem creation is Phase 6.
- No `parsedData` extraction. Structured roles/skills/requirements stay `null` on every row this phase writes. Phase 5 handles that.
- No public (unsigned) R2 URLs. Resumes are personal data; every fetch goes through a server-issued presigned URL.
- No file types beyond PDF for resumes. `.docx` / `.txt` can land in a follow-up; the upload route rejects others with 400.
- No edit flows (rename resume label, edit JD text). Only create / list / delete. Edit is Phase 3 or later.
- No bulk operations.
- Text-mode interviews stay stubbed as they are today.

---

## 2. Open decisions (calling out, not blocking)

I'll proceed with the recommendations unless you push back:

1. **PDF size cap** → 10 MB. Rejected with 400 above that.
2. **Resume `label` default** → the uploaded file's basename (minus `.pdf`). User can override in the upload dialog.
3. **JD `label` default** → `"Untitled JD"` if not provided. User can override inline.
4. **Signed URL TTL** → 15 minutes. Regenerated on each detail-page load.
5. **R2 bucket name** → from `CLOUDFLARE_R2_BUCKET` env var. One bucket, keys namespaced as `resumes/{userId}/{resumeId}.pdf`. Ensures easy per-user enumeration + deletion.
6. **Soft-deleted resumes/JDs** → remain referenced by historical `InterviewSession.resume_id` / `.job_description_id` rows (those FKs use `ON DELETE RESTRICT`). Soft delete does NOT cascade. Legacy sessions keep their library record visible via their `resumeId` FK even after the user "deletes" from their library view.
7. **UUID validation at API boundaries** → every `:id` route param is re-validated with zod (`z.string().uuid()`); invalid input → 400 without hitting Prisma.

---

## 3. Files to CREATE

| Path | Purpose |
| --- | --- |
| `lib/storage.ts` | R2 client (S3-compatible) + `uploadFile(buffer, key, contentType)` + `getSignedDownloadUrl(key, ttlSeconds?)` + `deleteFile(key)`. Reads R2 env vars. Throws a clear error when unset. |
| `lib/pdf.ts` | Thin wrapper around `pdf-parse` exposing `extractPdfText(buffer): Promise<{ text: string; pageCount: number }>`. Uses the deep import to avoid pdf-parse's test-pdf side effect. |
| `lib/storage-keys.ts` | One-liner helpers: `resumeKey(userId, resumeId)` / `jdKey(userId, jdId)` — so the key convention lives in one place. |
| `app/api/resumes/route.ts` | `POST` (multipart PDF upload) + `GET` (list user's resumes, newest first, auto-filtered by soft-delete extension). |
| `app/api/resumes/[id]/route.ts` | `DELETE` (soft delete via the extension) + `GET` (single resume with a freshly-minted presigned file URL; needed by the library UI to link "open PDF"). |
| `app/api/job-descriptions/route.ts` | `POST` (text + optional label) + `GET` (list user's JDs). |
| `app/api/job-descriptions/[id]/route.ts` | `DELETE` (soft) + `GET` (single JD; no presigned URL needed — it's just text). |
| `app/dashboard/library/page.tsx` | Server shell: `requireUser`, load user's resumes + JDs (prisma auto-filters soft-deleted), render `<LibraryTabs>`. |
| `app/dashboard/library/LibraryTabs.tsx` | Client component: shadcn `<Tabs>` — "Resumes" + "Job descriptions" panes. Each pane holds a list + "Add" button. |
| `app/dashboard/library/ResumeList.tsx` | Client list: rows (label + file name + created date + delete). Delete fires `DELETE /api/resumes/:id` and optimistically removes. |
| `app/dashboard/library/JdList.tsx` | Same shape for JDs. |
| `app/dashboard/library/UploadResumeDialog.tsx` | shadcn `<Dialog>` with file input, label input, submit → `POST /api/resumes` (multipart). On success: `router.refresh()` + close. |
| `app/dashboard/library/PasteJdDialog.tsx` | shadcn `<Dialog>` with label input + textarea, submit → `POST /api/job-descriptions`. |
| `app/interview/new/ResumeSelectDialog.tsx` | shadcn `<Dialog>` triggered from the setup form. Shows the user's resume library as a radio group (reuse the shape from `ResumeList`, not the component itself — this list has selection state, the library list has delete). Has an "Upload new" button that opens `UploadResumeDialog` nested (or reuses it as a child). On select → returns `{ id, label, fileName? }` to the parent form. |
| `app/interview/new/JdSelectDialog.tsx` | Same shape for JDs. "Paste new" opens the paste flow. |
| `types/next.d.ts` _(if needed)_ | Only if `@types/pdf-parse` turns out missing; skipped otherwise. |

---

## 4. Files to MODIFY

| Path | What changes |
| --- | --- |
| `app/interview/new/NewInterviewForm.tsx` | Replace `<Textarea name="jdText">` and `<Textarea name="resume">` with two selector triggers (buttons that open the dialogs above). Hidden inputs `resumeId` and `jobDescriptionId` carry the selected UUIDs. Show the selected resume's label + file name (or JD's label + first-line preview) inline once picked. Clear error state on change. |
| `app/interview/new/page.tsx` | Server component: fetch the user's resumes + JDs (prisma `findMany` — soft-delete extension auto-filters), pass as initial lists into `<NewInterviewForm>`. Empty states → the dialogs still work; they'll be empty until the user adds one. |
| `app/actions/interview.ts::startInterviewAction` | **Input shape changes**: `{ title, resumeId, jobDescriptionId, numQuestions, mode }` instead of `{ title, jdText, resume, numQuestions, mode }`. Validates against the updated zod schema. Before creating the session: `findFirst` the resume + JD by id **and userId** (ownership gate); if either is missing → return field error. Removes the in-action `prisma.resume.create` + `prisma.jobDescription.create` calls that used to synthesize rows from raw text. FKs on the session now point to the user-picked library entries. |
| `lib/validation.ts::startInterviewSchema` | Drop `jdText` + `resume` string fields. Add `resumeId: z.string().uuid()` + `jobDescriptionId: z.string().uuid()`. Change `mode: z.enum(["TEXT", "VOICE"])` to `z.enum(["text", "voice"])` since everything DB-side is now lowercase. |
| `components/dashboard/DashboardShell.tsx` | Add a "Library" nav link under the existing sidebar (between "Dashboard" and "New interview"). Icon: `FolderOpen` from lucide. The `active` prop type expands to accept `"library"`. |
| `app/dashboard/page.tsx` | One-line change: pass `active="dashboard"` becomes aware the shell now has a `"library"` slot — no behaviour change, just type alignment. |
| `.env.example` | Add the R2 env vars block with commentary: `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`. Plus the "how to get these" pointer. |
| `package.json` | Add runtime deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `pdf-parse`. Add dev dep: `@types/pdf-parse`. |

---

## 5. Existing routes / actions affected by the resumeId / jobDescriptionId shift

Short list — the schema already had these FKs, so most of the app already reads through them. The actual behavioural changes are localized:

1. **`app/actions/interview.ts::startInterviewAction`** — input shape changes (text → IDs), logic changes (picks from library, no row synthesis). Detailed above.
2. **`lib/validation.ts::startInterviewSchema`** — input fields change. Detailed above.
3. **`app/interview/new/NewInterviewForm.tsx`** — form field shape changes (hidden IDs instead of textareas). Detailed above.
4. **Everything else that reads JD or resume content (`app/interview/[id]/page.tsx`, `VoiceRoom.tsx`, `endVoiceCallAction`)** — **no changes needed**. They already pull `session.jobDescription.rawText` and `session.resume.extractedText` through the FK include pattern. The include in `app/interview/[id]/page.tsx:29–36` is already correct.
5. **`submitAnswerAction`** — still a stub; not touched.
6. **`scoreVoiceSessionAction`** — still a stub; not touched.
7. **Dashboard / detail pages** — already read `session.jobDescription?.label ?? session.resume?.label ?? "Untitled interview"` as the session title. Gets a bit nicer in practice now that library entries have real user-chosen labels. No code change.

---

## 6. Env vars added to `.env.example`

```
# Cloudflare R2 (S3-compatible blob storage for resume PDFs).
# 1. Create a bucket at https://dash.cloudflare.com/ → R2 → Create bucket.
# 2. Create an R2 API token with Object Read & Write for the bucket.
# 3. Paste the values below. Nothing about R2 is exposed to the browser.
CLOUDFLARE_R2_ACCOUNT_ID=""
CLOUDFLARE_R2_ACCESS_KEY_ID=""
CLOUDFLARE_R2_SECRET_ACCESS_KEY=""
CLOUDFLARE_R2_BUCKET="prepmate-resumes"
```

---

## 7. API contracts (summary; exact zod schemas live in code)

### `POST /api/resumes`
- Auth: `requireUser`
- Body: `multipart/form-data` with `file` (PDF, ≤10 MB) + optional `label`
- Behavior: validate → write `Resume` row with `extractedText = ""` to mint an id → upload PDF to R2 under `resumes/{userId}/{resumeId}.pdf` → run `extractPdfText` on the buffer → `update` row with `extractedText`, `fileUrl` (R2 path — **not** a public URL), `fileName`, `fileSizeBytes`. Returns `{ id, label, fileName, fileSizeBytes, createdAt }`.
- Errors: 400 (wrong MIME, too big, PDF extraction yields <40 chars), 500 (R2 failure — rolls back the Prisma row).

### `GET /api/resumes`
- Returns `Array<{ id, label, fileName, fileSizeBytes, createdAt }>` — newest first. Soft-deleted rows are invisible thanks to the client extension.

### `GET /api/resumes/[id]`
- Ownership-checked `findFirst`. Returns the same shape plus `signedUrl` (15 min TTL).

### `DELETE /api/resumes/[id]`
- Ownership-checked. Calls `prisma.resume.delete` → soft delete via the extension. Does NOT delete the R2 object (cheap to keep; we can reap later). Returns `{ ok: true }`.

### `POST /api/job-descriptions`
- Body: JSON `{ label?: string, rawText: string, companyName?: string, roleTitle?: string }`. `rawText` min length 40.
- Returns `{ id, label, rawText, companyName, roleTitle, createdAt }`.

### `GET /api/job-descriptions`
- List newest first. Same soft-delete behaviour.

### `GET /api/job-descriptions/[id]` + `DELETE /api/job-descriptions/[id]`
- Mirrors the resume endpoints. No signed URL (text only).

---

## 8. UI mental model

### `/dashboard/library`
- Left sidebar gets a new "Library" link (active).
- Page shell: header "Your library" + 2-tab `<Tabs>`.
- Each tab pane: empty state ("No resumes yet — upload your first one.") OR a list card.
- Each row: label (bold), secondary line (file name for resume, `roleTitle — companyName` for JD), tertiary line (created-at), "Delete" icon button on the right.
- "Add" button top-right opens the respective dialog.

### `/interview/new`
- Interview title input stays.
- The two textareas become two read-only tiles:
  - "Resume — click to pick" OR "Stripe SWE prep (stripe-swe-prep.pdf)" once selected.
  - "Job description — click to pick" OR "Senior FE @ Stripe · Click to change" once selected.
- Clicking either opens the selection dialog.
- Selection dialog is a scrollable radio list of the user's library, plus an "Upload new" / "Paste new" button at the top that opens the respective create dialog. After creating, the newly-created item is auto-selected.
- Hidden `<input type="hidden" name="resumeId" value="..." />` and `name="jobDescriptionId"` carry the IDs into the form submission.
- Number of questions + mode controls stay unchanged.

### Dialogs — shadcn/ui components reused
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` (already in `components/ui/dialog.tsx`)
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (already in `components/ui/tabs.tsx`)
- `Input`, `Textarea`, `Button`, `Label` (existing)
- No new primitives needed from shadcn CLI.

---

## 9. Verification plan (what I'll check before reporting done)

1. `npm run build` passes.
2. `npm run lint` passes.
3. Manual walk-through (dev server): create one PDF resume and one JD via `/dashboard/library`; both appear in their tabs; delete one of each — disappears from list; database row has `deleted_at IS NOT NULL`.
4. `/interview/new` → resume selector and JD selector both open, list the remaining rows, let me pick one each; start a voice interview; `interview_sessions.resume_id` and `.job_description_id` in the DB match the picked rows.
5. Existing voice interview flow still works end-to-end (Maya connects, call ends, transcript saved). ReportCard still not generated — that's Phase 6 — but the session survives with the correct FKs.
6. Try `DELETE /api/resumes/:id` on a resume referenced by a historical session → succeeds (soft delete doesn't fire the `RESTRICT` cascade, which is the point).
7. Upload a non-PDF → rejected at the route with 400.
8. Upload a 20 MB PDF → rejected at the route with 400.

---

## 10. Stop

Not writing any code until you've read and approved this plan. When you say go, I'll execute in this order:

1. Deps + env (`package.json`, `.env.example`, R2 bucket creation happens on your side).
2. `lib/storage.ts` + `lib/pdf.ts` + `lib/storage-keys.ts`.
3. Resume endpoints (POST upload is the riskiest — I'll test it first).
4. JD endpoints.
5. `/dashboard/library` page + dialogs.
6. `/interview/new` refactor + action + validation changes.
7. Build + lint + manual walkthrough.
8. Report what's green and what's broken.
