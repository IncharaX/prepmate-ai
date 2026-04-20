/**
 * Evaluator prompts and schemas. Three LLM calls per session:
 *   - overall:     one ReportCard-shaped object
 *   - perQuestion: one QuestionEvaluation per planned question (fanned out)
 *   - jdFit:       one JdFitItem[] matrix
 *
 * Every quote the model cites should reference a transcript line via its
 * "T<turnIndex>" prefix (e.g. "T7"). The server resolves these to real
 * turn UUIDs post-hoc and drops any that don't exist.
 */
import { z } from "zod";

import { intScore, renderRubricForPrompt } from "@/lib/rubric";

// ============================================================
// Schemas
// ============================================================

const turnRef = z
  .string()
  .regex(/^T\d+$/, { message: "turnRef must be like 'T<integer>'" });

const strengthOrGap = z.object({
  title: z.string().min(3).max(100),
  detail: z.string().min(10).max(400),
  transcriptQuote: z.string().max(300).optional().nullable(),
  turnRef: turnRef.optional().nullable(),
});

export const overallReportSchema = z.object({
  overallScore: intScore,
  recommendation: z.enum(["strong_yes", "yes", "maybe", "no", "strong_no"]),
  recommendationReason: z.string().min(20).max(800),
  scoreCommunication: intScore,
  scoreJdRelevance: intScore,
  scoreExperienceDepth: intScore,
  scoreSpecificity: intScore,
  scoreConfidence: intScore,
  // Empty arrays are valid: a very short or thin interview may not have enough
  // signal for a cite-able strength or gap. Better an empty section than a
  // fabricated one. Max 6 keeps the UI legible.
  strengths: z.array(strengthOrGap).max(6),
  gaps: z.array(strengthOrGap).max(6),
  summary: z.string().min(60).max(1200),
});

export type OverallReport = z.infer<typeof overallReportSchema>;

export const questionEvalSchema = z.object({
  questionIndex: z.number().int().min(0).max(15),
  questionText: z.string().min(5).max(500),
  answerSummary: z.string().min(10).max(400),
  score: intScore,
  whatWorked: z.string().max(400).optional().nullable(),
  whatToImprove: z.string().max(400).optional().nullable(),
  transcriptQuote: z.string().max(300).optional().nullable(),
  turnRef: turnRef.optional().nullable(),
});

export type QuestionEval = z.infer<typeof questionEvalSchema>;

export const jdFitSchema = z.object({
  items: z
    .array(
      z.object({
        requirement: z.string().min(3).max(200),
        isMustHave: z.boolean(),
        status: z.enum(["met", "partial", "unclear", "not_shown"]),
        evidence: z.string().max(300).optional().nullable(),
        turnRef: turnRef.optional().nullable(),
      }),
    )
    .min(1)
    .max(20),
});

export type JdFitResult = z.infer<typeof jdFitSchema>;

// ============================================================
// Shared system prompt
// ============================================================

export const evaluatorSystemPrompt = `You are the evaluator inside PrepMate AI. You read a completed mock-interview transcript and score the candidate using a fixed rubric. You are honest, specific, and rigorously grounded in what the transcript actually contains. You never invent quotes, never fabricate claims about the candidate's experience, and never score higher than the evidence supports.

Citation rule (hard): whenever you quote or paraphrase the transcript, you MUST cite the exact source turn using its "T<turnIndex>" prefix (e.g. "T7"). If you cannot tie a claim to a specific transcript turn, set "turnRef" to null rather than inventing one. Quotes must appear verbatim in the transcript (modulo leading/trailing whitespace).

You always return valid JSON that matches the schema exactly. Do not wrap in markdown, do not add commentary, do not preface with anything.`;

// ============================================================
// Prompt builders
// ============================================================

export type BuildOverallInput = {
  resumeText: string;
  jdText: string;
  questionPlan: Array<{ index: number; category: string; question: string; rationale?: string }>;
  transcript: string; // pre-formatted "[T0] (interviewer) ..." block
};

export function buildOverallUserPrompt(input: BuildOverallInput): string {
  return JSON.stringify({
    task: "Produce the overall ReportCard matching the schema.",
    rubric: renderRubricForPrompt(),
    jobDescription: input.jdText,
    candidateResume: input.resumeText,
    questionPlan: input.questionPlan,
    transcript: input.transcript,
    outputSchema: {
      overallScore: "integer 0-100",
      recommendation: "'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no'",
      recommendationReason: "one paragraph — the single most important reason for this recommendation",
      scoreCommunication: "integer 0-100 — per the rubric anchors",
      scoreJdRelevance: "integer 0-100",
      scoreExperienceDepth: "integer 0-100",
      scoreSpecificity: "integer 0-100",
      scoreConfidence: "integer 0-100",
      strengths:
        "array of 0-6 { title, detail, transcriptQuote?, turnRef? } — concrete things this candidate did well in THIS interview. Return [] if the transcript is too thin to support any; do NOT invent one.",
      gaps:
        "array of 0-6 { title, detail, transcriptQuote?, turnRef? } — specific opportunities to sharpen, phrased as actionable coaching, not judgment. Return [] if the transcript is too thin to support any.",
      summary:
        "one or two paragraphs of honest narrative assessment, written TO the candidate in second person — not marketing fluff",
    },
    rules: [
      "Every cited quote must appear verbatim in the transcript, referenced by its T<turnIndex>.",
      "If a dimension genuinely wasn't tested (e.g. no behavioral question was answered), set that score at the 'not demonstrated' anchor rather than guessing — 40 is the floor for 'data-thin'; 20 means 'counter-evidence present'.",
      "The recommendation must be coherent with the overall score. strong_yes ≈ 85+, yes ≈ 70-84, maybe ≈ 55-69, no ≈ 40-54, strong_no ≈ <40. Break this rule only with a concrete reason in recommendationReason.",
      "Strengths and gaps must be different things — don't repeat the same point.",
      "Prefer an empty array over fabricating a strength or gap when the transcript doesn't support one. A short or thin interview honestly yielding [] is better than invented feedback.",
    ],
  });
}

export type BuildQuestionEvalInput = {
  resumeText: string;
  jdText: string;
  question: { index: number; category: string; question: string; rationale?: string };
  windowedTurns: string; // only the turns belonging to this question, same "[T#]" format
};

export function buildQuestionEvalUserPrompt(input: BuildQuestionEvalInput): string {
  return JSON.stringify({
    task: "Evaluate the candidate's answer to ONE specific question.",
    rubric: renderRubricForPrompt(),
    jobDescription: input.jdText,
    candidateResume: input.resumeText,
    question: input.question,
    transcriptWindow: input.windowedTurns,
    outputSchema: {
      questionIndex: "integer — must equal the question's index from the question plan",
      questionText: "string — the exact question Maya asked",
      answerSummary: "one or two sentences summarising what the candidate said, paraphrased",
      score: "integer 0-100, weighted toward how well THIS answer addressed THIS question",
      whatWorked: "string or null — one concrete thing the candidate did well in this answer",
      whatToImprove: "string or null — one specific, actionable coaching note",
      transcriptQuote: "string or null — short verbatim quote from the candidate that supports the score",
      turnRef: "string like 'T7' or null — the turn the quote came from",
    },
    rules: [
      "Grade the ANSWER, not the candidate's overall performance — focus strictly on this window.",
      "whatWorked and whatToImprove should be specific to this answer, not generic advice.",
      "If the candidate didn't answer the question at all, score ≤ 30 and explain why in whatToImprove.",
    ],
  });
}

export type BuildJdFitInput = {
  jdParsed?: unknown | null;
  jdRawText: string;
  resumeText: string;
  transcript: string;
};

export function buildJdFitUserPrompt(input: BuildJdFitInput): string {
  const jdSource =
    input.jdParsed && typeof input.jdParsed === "object"
      ? { structured: input.jdParsed }
      : { rawText: input.jdRawText };

  return JSON.stringify({
    task: "Produce the JD-fit matrix — one row per meaningful requirement the JD names.",
    jd: jdSource,
    candidateResume: input.resumeText,
    transcript: input.transcript,
    outputSchema: {
      items:
        "array of 1-20 { requirement, isMustHave, status, evidence?, turnRef? } — one row per requirement",
    },
    requirementGuidance: [
      "Pull requirements from the JD. Prefer the structured must-haves/nice-to-haves if the parsed JD provides them; otherwise extract the most substantive requirement phrases from the raw text.",
      "isMustHave = true for JD must-haves, false for nice-to-haves. Guess conservatively if unclear.",
    ],
    statusGuidance: [
      "'met' — the transcript shows concrete evidence the candidate meets this requirement.",
      "'partial' — the candidate demonstrates SOME of it but not fully (e.g. related experience but at a smaller scale).",
      "'unclear' — the candidate mentioned the area but the depth/strength isn't established.",
      "'not_shown' — no evidence in the transcript either way. This is the correct call when the interview didn't cover this requirement; it is NOT a negative.",
    ],
    rules: [
      "Evidence is a short paraphrase or verbatim quote. Must reference the transcript via T<turnIndex>.",
      "If status is 'not_shown', evidence and turnRef must be null.",
      "Don't invent requirements the JD doesn't name.",
    ],
  });
}

// ============================================================
// Formatters
// ============================================================

/**
 * Render the entire transcript as `[Tn] (speaker) content` lines. Used as the
 * overall + JD-fit prompt input. The `[T<turnIndex>]` prefix is the stable
 * identifier the LLM cites; we resolve it back to a turn.id server-side.
 */
export function formatTranscript(
  turns: ReadonlyArray<{ turnIndex: number; speaker: "interviewer" | "candidate"; content: string }>,
): string {
  return turns
    .slice()
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .map((t) => `[T${t.turnIndex}] (${t.speaker}) ${t.content.trim()}`)
    .join("\n");
}

/**
 * Render only the turns that belong to one question (contiguous window in
 * turnIndex order). Caller slices.
 */
export function formatWindowedTurns(
  turns: ReadonlyArray<{ turnIndex: number; speaker: "interviewer" | "candidate"; content: string }>,
): string {
  return formatTranscript(turns);
}

/**
 * Map an LLM-provided "T7" back to a real turn.id. Returns null if the
 * reference doesn't resolve — callers should drop the turnId silently and
 * keep the quote string itself.
 */
export function resolveTurnRef(
  ref: string | null | undefined,
  turns: ReadonlyArray<{ id: string; turnIndex: number }>,
): string | null {
  if (!ref) return null;
  const match = ref.match(/^T(\d+)$/);
  if (!match) return null;
  const idx = Number(match[1]);
  const hit = turns.find((t) => t.turnIndex === idx);
  return hit?.id ?? null;
}
