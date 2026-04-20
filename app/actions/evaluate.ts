"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { runWithConcurrency } from "@/lib/concurrency";
import { callLlmJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { plannerResponseSchema, type PlannerResponse } from "@/lib/prompts/planner";
import {
  buildJdFitUserPrompt,
  buildOverallUserPrompt,
  buildQuestionEvalUserPrompt,
  evaluatorSystemPrompt,
  formatTranscript,
  formatWindowedTurns,
  jdFitSchema,
  overallReportSchema,
  questionEvalSchema,
  resolveTurnRef,
  type QuestionEval,
} from "@/lib/prompts/evaluator";
import { mapTurnsToQuestions, type MappableTurn } from "@/lib/question-mapping";
import { RUBRIC_VERSION } from "@/lib/rubric";

const DEFAULT_EVALUATOR_MODEL = "gpt-4o";
const QUESTION_CONCURRENCY = 3;

/** Prefer the new OPENAI_* name, fall back to OPENROUTER_* for legacy .env files. */
function evaluatorModel(): string {
  return (
    process.env.OPENAI_EVALUATOR_MODEL ??
    process.env.OPENROUTER_EVALUATOR_MODEL ??
    DEFAULT_EVALUATOR_MODEL
  );
}

export type EvaluateResult =
  | { ok: true; alreadyDone?: true }
  | { ok: false; message: string };

export type EvaluationStatus =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "error"; message: string };

/**
 * Lightweight lookup used by the detail-page poller. Never triggers the LLM.
 * Returns "ready" if a current ReportCard exists, "error" if the last known
 * state was a failed evaluation, otherwise "pending".
 */
export async function getEvaluationStatusAction(sessionId: string): Promise<EvaluationStatus> {
  const user = await requireUser();
  const session = await prisma.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: {
      status: true,
      errorMessage: true,
      reportCards: { where: { isCurrent: true }, select: { id: true }, take: 1 },
    },
  });
  if (!session) return { status: "error", message: "Interview not found." };
  if (session.reportCards.length > 0) return { status: "ready" };
  if (session.status === "completed_partial" && session.errorMessage) {
    return { status: "error", message: session.errorMessage };
  }
  if (session.status === "failed" && session.errorMessage) {
    return { status: "error", message: session.errorMessage };
  }
  return { status: "pending" };
}

export async function retryEvaluationAction(sessionId: string): Promise<EvaluateResult> {
  const user = await requireUser();
  await prisma.interviewSession.updateMany({
    where: { id: sessionId, userId: user.id },
    data: { errorMessage: null },
  });
  return evaluateInterviewSession(sessionId);
}

/**
 * The only path that writes ReportCard + QuestionEvaluation + JdFitItem rows.
 * Idempotent: short-circuits if an `isCurrent` ReportCard already exists.
 *
 * Flow:
 *  1. Ownership + state guards.
 *  2. Load transcript + resume + JD + questionPlan (from prepData).
 *  3. Map turns → questions (pure heuristic, bulk updates via transaction).
 *  4. Run three LLM evaluations in parallel (overall, per-Q, JD-fit).
 *  5. If overall failed → mark session completed_partial + errorMessage, no
 *     ReportCard row created.
 *  6. Else: atomic transaction inserts ReportCard + children.
 *  7. If perQ/jdFit had partial failures → session completed_partial + note.
 *     Full success → session stays completed, errorMessage null.
 */
export async function evaluateInterviewSession(sessionId: string): Promise<EvaluateResult> {
  const user = await requireUser();

  const session = await prisma.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: {
      resume: { select: { extractedText: true } },
      jobDescription: { select: { rawText: true, parsedData: true } },
      transcriptTurns: { orderBy: { turnIndex: "asc" } },
      reportCards: { where: { isCurrent: true }, select: { id: true }, take: 1 },
    },
  });

  if (!session) {
    return { ok: false, message: "Interview not found." };
  }
  if (session.reportCards.length > 0) {
    return { ok: true, alreadyDone: true };
  }
  if (session.mode !== "voice") {
    return { ok: false, message: "Text mode evaluation is not supported yet." };
  }
  if (session.status !== "completed" && session.status !== "completed_partial") {
    return { ok: false, message: `Session is ${session.status}; nothing to evaluate yet.` };
  }

  const candidateTurns = session.transcriptTurns.filter((t) => t.speaker === "candidate");
  if (candidateTurns.length === 0) {
    await markSessionPartial(session.id, "No candidate answers recorded.");
    return { ok: false, message: "No candidate answers recorded." };
  }

  // ---- Plan + transcript formatting ----

  const plan = extractPlan(session.prepData);
  const questionPlan: PlannerResponse["questionPlan"] = plan?.questionPlan ?? [];
  const expectedQuestionCount = questionPlan.length || session.questionCount;

  const mappable: MappableTurn[] = session.transcriptTurns.map((t) => ({
    id: t.id,
    turnIndex: t.turnIndex,
    speaker: t.speaker,
    content: t.content,
  }));
  const { turnIdToQuestionIndex } = mapTurnsToQuestions(mappable, expectedQuestionCount);

  const transcriptText = formatTranscript(session.transcriptTurns);
  const resumeText = session.resume.extractedText;
  const jdText = session.jobDescription.rawText;

  // ---- Kick off all three LLM branches in parallel ----

  const model = evaluatorModel();
  const baseOpts = { userId: user.id, sessionId: session.id, model } as const;

  const overallPromise = callLlmJson({
    ...baseOpts,
    purpose: "evaluation",
    schema: overallReportSchema,
    temperature: 0.2,
    messages: [
      { role: "system", content: evaluatorSystemPrompt },
      {
        role: "user",
        content: buildOverallUserPrompt({
          resumeText,
          jdText,
          questionPlan,
          transcript: transcriptText,
        }),
      },
    ],
  });

  const perQPromise = (async () => {
    if (questionPlan.length === 0) return [] as Array<Awaited<ReturnType<typeof callLlmJson<QuestionEval>>>>;
    return runWithConcurrency(questionPlan, QUESTION_CONCURRENCY, async (question) => {
      const windowTurns = session.transcriptTurns.filter(
        (t) => turnIdToQuestionIndex[t.id] === question.index - 1 || turnIdToQuestionIndex[t.id] === question.index,
      );
      // The planner's indexes are 1-based; our turn mapping is 0-based. We
      // accept both to be forgiving against off-by-ones without fabricating.
      const formatted = formatWindowedTurns(
        windowTurns.length > 0
          ? windowTurns
          : session.transcriptTurns, // fall back to the whole transcript if windowing came up empty
      );
      return callLlmJson({
        ...baseOpts,
        purpose: "question_evaluation",
        schema: questionEvalSchema,
        temperature: 0.2,
        messages: [
          { role: "system", content: evaluatorSystemPrompt },
          {
            role: "user",
            content: buildQuestionEvalUserPrompt({
              resumeText,
              jdText,
              question: {
                index: question.index,
                category: question.category,
                question: question.question,
                rationale: question.rationale,
              },
              windowedTurns: formatted,
            }),
          },
        ],
      });
    });
  })();

  const jdFitPromise = callLlmJson({
    ...baseOpts,
    purpose: "jd_fit_analysis",
    schema: jdFitSchema,
    temperature: 0.2,
    messages: [
      { role: "system", content: evaluatorSystemPrompt },
      {
        role: "user",
        content: buildJdFitUserPrompt({
          jdParsed: session.jobDescription.parsedData,
          jdRawText: jdText,
          resumeText,
          transcript: transcriptText,
        }),
      },
    ],
  });

  const [overallRes, perQResArr, jdFitRes] = await Promise.all([
    overallPromise,
    perQPromise,
    jdFitPromise,
  ]);

  // ---- Hard fail: overall must succeed ----

  if (!overallRes.ok) {
    const msg = `Overall evaluation failed: ${overallRes.error}`;
    console.error(msg);
    await markSessionPartial(session.id, truncate(msg, 300));
    return { ok: false, message: msg };
  }

  const overall = overallRes.data;

  // ---- Partial failures are allowed for per-Q + JD-fit ----

  const successfulPerQ: QuestionEval[] = [];
  const perQFailCount = perQResArr.filter((r) => !r.ok).length;
  for (const r of perQResArr) {
    if (r.ok) successfulPerQ.push(r.data);
  }
  const jdFitItems = jdFitRes.ok ? jdFitRes.data.items : [];
  const jdFitFailed = !jdFitRes.ok;

  // ---- Resolve turnRefs → turnIds ----

  const turnsForResolve = session.transcriptTurns.map((t) => ({
    id: t.id,
    turnIndex: t.turnIndex,
  }));

  const resolvedStrengths = overall.strengths.map((s) => ({
    title: s.title,
    detail: s.detail,
    transcriptQuote: s.transcriptQuote ?? null,
    turnId: resolveTurnRef(s.turnRef, turnsForResolve),
  }));
  const resolvedGaps = overall.gaps.map((g) => ({
    title: g.title,
    detail: g.detail,
    transcriptQuote: g.transcriptQuote ?? null,
    turnId: resolveTurnRef(g.turnRef, turnsForResolve),
  }));

  const qeRows = successfulPerQ.map((q) => ({
    questionIndex: q.questionIndex,
    questionText: q.questionText,
    answerSummary: q.answerSummary,
    score: q.score,
    whatWorked: q.whatWorked ?? null,
    whatToImprove: q.whatToImprove ?? null,
    transcriptQuote: q.transcriptQuote ?? null,
    // turnId isn't on QuestionEvaluation schema — we store only the quote text.
    // If we later add a FK column, resolve via resolveTurnRef here.
  }));

  const dedupedQeRows = dedupeByQuestionIndex(qeRows);

  const fitRows = jdFitItems.map((item) => ({
    requirement: item.requirement,
    isMustHave: item.isMustHave,
    status: item.status,
    evidence: item.evidence ?? null,
    turnId: resolveTurnRef(item.turnRef, turnsForResolve),
  }));

  // ---- Atomic write ----

  const turnUpdateOps = Object.entries(turnIdToQuestionIndex).map(([turnId, questionIndex]) =>
    prisma.transcriptTurn.update({
      where: { id: turnId },
      data: { questionIndex },
    }),
  );

  try {
    await prisma.$transaction([
      ...turnUpdateOps,
      prisma.reportCard.updateMany({
        where: { sessionId: session.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.reportCard.create({
        data: {
          sessionId: session.id,
          rubricVersion: RUBRIC_VERSION,
          evaluatorModel: model,
          overallScore: overall.overallScore,
          recommendation: overall.recommendation,
          recommendationReason: overall.recommendationReason,
          scoreCommunication: overall.scoreCommunication,
          scoreJdRelevance: overall.scoreJdRelevance,
          scoreExperienceDepth: overall.scoreExperienceDepth,
          scoreSpecificity: overall.scoreSpecificity,
          scoreConfidence: overall.scoreConfidence,
          strengths: resolvedStrengths as unknown as object,
          gaps: resolvedGaps as unknown as object,
          summary: overall.summary,
          rawLlmResponse: overall as unknown as object,
          isCurrent: true,
          questionEvaluations:
            dedupedQeRows.length > 0
              ? { create: dedupedQeRows }
              : undefined,
          jdFitItems:
            fitRows.length > 0
              ? { create: fitRows }
              : undefined,
        },
      }),
    ]);
  } catch (error) {
    const msg = `Failed to persist ReportCard: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    await markSessionPartial(session.id, truncate(msg, 300));
    return { ok: false, message: msg };
  }

  // ---- Session post-state ----

  const partialNotes: string[] = [];
  if (perQFailCount > 0) {
    partialNotes.push(`${successfulPerQ.length}/${questionPlan.length} per-question evals scored`);
  }
  if (jdFitFailed) partialNotes.push("JD-fit analysis failed");

  if (partialNotes.length > 0) {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        status: "completed_partial",
        errorMessage: `Partial: ${partialNotes.join("; ")}`,
      },
    });
  } else {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: "completed", errorMessage: null },
    });
  }

  revalidatePath(`/dashboard/interview/${session.id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ============================================================
// Helpers
// ============================================================

async function markSessionPartial(sessionId: string, message: string): Promise<void> {
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "completed_partial", errorMessage: message },
  });
  revalidatePath(`/dashboard/interview/${sessionId}`);
}

function extractPlan(prepData: unknown): PlannerResponse | null {
  if (!prepData || typeof prepData !== "object") return null;
  const parsed = plannerResponseSchema.safeParse(prepData);
  return parsed.success ? parsed.data : null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function dedupeByQuestionIndex<T extends { questionIndex: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.questionIndex)) continue;
    seen.add(r.questionIndex);
    out.push(r);
  }
  return out;
}

