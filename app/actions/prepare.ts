"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { callLlmJson } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import {
  buildJdParserUser,
  buildResumeParserUser,
  jdParsedSchema,
  jdParserSystem,
  resumeParsedSchema,
  resumeParserSystem,
} from "@/lib/prompts/parsers";
import {
  buildPlannerUserPrompt,
  plannerResponseSchema,
  plannerSystemPrompt,
} from "@/lib/prompts/planner";

const DEFAULT_PLANNER_MODEL = "gpt-4o";
const DEFAULT_PARSER_MODEL = "gpt-4o-mini";

/** Prefer the new OPENAI_* name, fall back to OPENROUTER_* for legacy .env files. */
function plannerModel(): string {
  return (
    process.env.OPENAI_PLANNER_MODEL ??
    process.env.OPENROUTER_PLANNER_MODEL ??
    DEFAULT_PLANNER_MODEL
  );
}

function parserModel(): string {
  return (
    process.env.OPENAI_PARSER_MODEL ??
    process.env.OPENROUTER_PARSER_MODEL ??
    DEFAULT_PARSER_MODEL
  );
}

export type PrepareResult =
  | { ok: true; alreadyDone?: true }
  | { ok: false; message: string };

/**
 * Runs the planner LLM once for a session and persists its output.
 * Idempotent — if prep already completed, short-circuits.
 * On failure the session is marked `failed` with `errorMessage` populated so
 * the prepare page can render a retry state.
 */
export async function prepareInterviewSession(sessionId: string): Promise<PrepareResult> {
  const user = await requireUser();

  const session = await prisma.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { resume: true, jobDescription: true },
  });
  if (!session) {
    return { ok: false, message: "Interview not found." };
  }

  if (session.prepCompletedAt) {
    return { ok: true, alreadyDone: true };
  }

  // Block the planner on already-ended sessions but allow retry on `failed`.
  const blocked =
    session.status === "completed" ||
    session.status === "completed_partial" ||
    session.status === "abandoned";
  if (blocked) {
    return { ok: true, alreadyDone: true };
  }

  const resumeText = session.resume.extractedText;
  const jdText = session.jobDescription.rawText;

  if (!resumeText || resumeText.length < 20) {
    await failSession(session.id, "Resume is empty or unreadable.");
    return { ok: false, message: "Resume is empty or unreadable." };
  }
  if (!jdText || jdText.length < 20) {
    await failSession(session.id, "Job description is empty or too short.");
    return { ok: false, message: "Job description is empty or too short." };
  }

  const model = plannerModel();
  const result = await callLlmJson({
    purpose: "interview_prep",
    model,
    userId: user.id,
    sessionId: session.id,
    temperature: 0.2,
    schema: plannerResponseSchema,
    messages: [
      { role: "system", content: plannerSystemPrompt },
      {
        role: "user",
        content: buildPlannerUserPrompt({
          resumeText,
          jdText,
          questionCount: session.questionCount,
          interviewType: session.interviewType,
          difficulty: session.difficulty,
        }),
      },
    ],
  });

  if (!result.ok) {
    console.error(`planner failed for session ${session.id}:`, result.error);
    await failSession(session.id, result.error);
    return { ok: false, message: summariseError(result.error) };
  }

  // Sanity check: log (but don't reject) when the model returned a different
  // count than we asked for. Pragmatic — the schema already bounds the array.
  if (result.data.questionPlan.length !== session.questionCount) {
    console.warn(
      `planner returned ${result.data.questionPlan.length} questions, expected ${session.questionCount} (session=${session.id})`,
    );
  }

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      prepData: result.data as unknown as object,
      prepModel: model,
      prepCompletedAt: new Date(),
      status: "ready",
      errorMessage: null,
    },
  });

  revalidatePath(`/interview/${session.id}/prepare`);
  revalidatePath(`/interview/${session.id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function retryPrepAction(sessionId: string): Promise<PrepareResult> {
  // `prepareInterviewSession` already handles the failed → ready transition,
  // but we also null out errorMessage before re-running so the UI doesn't
  // flash stale text while the new call is in flight.
  const user = await requireUser();
  await prisma.interviewSession.updateMany({
    where: { id: sessionId, userId: user.id, status: "failed" },
    data: { errorMessage: null },
  });
  return prepareInterviewSession(sessionId);
}

// --- background parsers ---------------------------------------------------
// Called via `after()` from upload routes. Non-blocking, best-effort. Failure
// is tolerated: parsedData stays null, the planner still works from raw text.

export async function parseResumeInBackground(resumeId: string, userId: string): Promise<void> {
  try {
    const resume = await prisma.resume.findFirst({
      where: { id: resumeId, userId },
      select: { id: true, extractedText: true, parsedData: true },
    });
    if (!resume || resume.parsedData) return;
    if (!resume.extractedText || resume.extractedText.length < 40) return;

    const result = await callLlmJson({
      purpose: "resume_parse",
      model: parserModel(),
      userId,
      temperature: 0.1,
      schema: resumeParsedSchema,
      messages: [
        { role: "system", content: resumeParserSystem },
        { role: "user", content: buildResumeParserUser(resume.extractedText) },
      ],
    });

    if (!result.ok) {
      console.warn(`[parseResume] ${resumeId} failed:`, result.error);
      return;
    }
    await prisma.resume.update({
      where: { id: resume.id },
      data: { parsedData: result.data as unknown as object },
    });
  } catch (error) {
    console.error(`[parseResume] ${resumeId} threw:`, error);
  }
}

export async function parseJdInBackground(jdId: string, userId: string): Promise<void> {
  try {
    const jd = await prisma.jobDescription.findFirst({
      where: { id: jdId, userId },
      select: { id: true, rawText: true, parsedData: true },
    });
    if (!jd || jd.parsedData) return;
    if (!jd.rawText || jd.rawText.length < 40) return;

    const result = await callLlmJson({
      purpose: "jd_parse",
      model: parserModel(),
      userId,
      temperature: 0.1,
      schema: jdParsedSchema,
      messages: [
        { role: "system", content: jdParserSystem },
        { role: "user", content: buildJdParserUser(jd.rawText) },
      ],
    });

    if (!result.ok) {
      console.warn(`[parseJd] ${jdId} failed:`, result.error);
      return;
    }
    await prisma.jobDescription.update({
      where: { id: jd.id },
      data: { parsedData: result.data as unknown as object },
    });
  } catch (error) {
    console.error(`[parseJd] ${jdId} threw:`, error);
  }
}

// --- helpers --------------------------------------------------------------

async function failSession(sessionId: string, errorMessage: string): Promise<void> {
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "failed", errorMessage: errorMessage.slice(0, 300) },
  });
  revalidatePath(`/interview/${sessionId}/prepare`);
}

function summariseError(raw: string): string {
  if (raw.toLowerCase().includes("timeout")) return "Maya took too long to prepare — please retry.";
  if (raw.toLowerCase().includes("openai")) return "The planning service is unavailable right now.";
  return "Maya couldn't finish preparing — please retry.";
}
