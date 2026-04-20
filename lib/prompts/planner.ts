/**
 * Planner prompt: reads the candidate's resume + the job description and
 * outputs a structured question plan that Maya (the voice interviewer) will
 * follow. Runs once per interview session, before the call starts.
 */
import { z } from "zod";

export const plannerResponseSchema = z.object({
  resumeSummary: z
    .string()
    .min(20, { message: "resumeSummary too short" })
    .max(2000, { message: "resumeSummary too long" }),
  jdSummary: z.object({
    mustHaves: z.array(z.string().min(2).max(200)).min(1).max(10),
    niceToHaves: z.array(z.string().min(2).max(200)).max(10),
    seniority: z.string().min(1).max(50),
    domain: z.string().min(1).max(80),
  }),
  questionPlan: z
    .array(
      z.object({
        index: z.number().int().min(1).max(20),
        category: z.enum([
          "warmup",
          "resume_probe",
          "jd_fit",
          "behavioral",
          "scenario",
          "wrap",
        ]),
        question: z.string().min(10).max(400),
        rationale: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(12),
});

export type PlannerResponse = z.infer<typeof plannerResponseSchema>;
export type PlannerCategory = PlannerResponse["questionPlan"][number]["category"];

export const plannerSystemPrompt = `You are the interview planner inside PrepMate AI. You read a candidate's resume, a job description, and the session parameters (question count, interview type, difficulty), and return a structured question plan that the voice interviewer ("Maya") will follow.

You are precise, grounded strictly in the documents provided, and you never invent facts about the candidate or the company. If the resume or JD is truncated, work with what's there. If a field you'd normally cite is missing, pick a different angle rather than make something up.

Rules for the question plan:
- Return EXACTLY the requested question count. No more, no less.
- index starts at 1 and increments by 1 with no gaps.
- First question has category "warmup". Last has category "wrap".
- When questionCount ≥ 4, include at least one "resume_probe" and one "jd_fit".
- Mix categories naturally — don't bunch all behaviorals together.
- Each "question" field is a complete sentence the interviewer could speak verbatim. Short, specific, one ask per question.
- Each "rationale" explains in one sentence why this question matters for THIS candidate and THIS role (mentioning concrete signals from the resume or JD). The rationale is private to the product — it won't be read to the candidate.

You always return valid JSON that matches the schema exactly. Do not wrap in markdown, do not add commentary, do not preface with anything.`;

export type PlannerUserPromptInput = {
  resumeText: string;
  jdText: string;
  questionCount: number;
  interviewType: "hr_screen" | "behavioral" | "technical_screen" | "mixed";
  difficulty: "entry" | "mid" | "senior";
};

export function buildPlannerUserPrompt(input: PlannerUserPromptInput): string {
  return JSON.stringify({
    task: "Produce the question plan described in the system prompt.",
    parameters: {
      questionCount: input.questionCount,
      interviewType: input.interviewType,
      difficulty: input.difficulty,
    },
    jobDescription: input.jdText,
    candidateResume: input.resumeText,
    outputSchema: {
      resumeSummary: "string (20–2000 chars, third-person, 2–4 sentences)",
      jdSummary: {
        mustHaves: "array of 1–10 short strings — concrete requirements from the JD",
        niceToHaves: "array of 0–10 short strings — non-blocking preferences",
        seniority: "string like 'entry' | 'mid' | 'senior' | 'staff'",
        domain: "string — 1–3 words, e.g. 'fintech payments' or 'consumer social'",
      },
      questionPlan: [
        {
          index: "integer starting at 1",
          category:
            "'warmup' | 'resume_probe' | 'jd_fit' | 'behavioral' | 'scenario' | 'wrap'",
          question: "the exact sentence the interviewer will speak",
          rationale:
            "one-sentence private note on why this question matters for this candidate/role",
        },
      ],
    },
  });
}

/**
 * Compact form for the ElevenLabs `question_plan` dynamic variable. Each line
 * is `N) [category] question`. Trimmed at `maxChars` via word-boundary cut.
 */
export function formatQuestionPlanForAgent(
  plan: PlannerResponse["questionPlan"],
  maxChars: number,
): string {
  const lines = plan
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((q) => `${q.index}) [${q.category}] ${q.question}`);
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  // Simple word-boundary trim — we don't import truncateAtWord here to keep
  // this module free of app-layer deps.
  const hardCut = joined.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(" ");
  const cutAt = lastSpace > maxChars * 0.7 ? lastSpace : maxChars;
  return `${hardCut.slice(0, cutAt).trimEnd()}… [truncated]`;
}

export type PrepPreviewItem = { index: number; category: PlannerCategory; title: string };

/**
 * Candidate-facing preview ("Maya will cover:"). Omits the actual questions —
 * we don't want to reveal the plan — and just describes the category in
 * human-readable form.
 */
export function buildPrepPreview(plan: PlannerResponse["questionPlan"]): PrepPreviewItem[] {
  return plan
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((q) => ({
      index: q.index,
      category: q.category,
      title: CATEGORY_TITLES[q.category],
    }));
}

const CATEGORY_TITLES: Record<PlannerCategory, string> = {
  warmup: "A warm start — a short opener",
  resume_probe: "A deeper look at something on your resume",
  jd_fit: "How your experience maps to the role",
  behavioral: "A behavioral question (past situation, your actions)",
  scenario: "A scenario — what would you do if…",
  wrap: "Wrap — your questions for Maya",
};
