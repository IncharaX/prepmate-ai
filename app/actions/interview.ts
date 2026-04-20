"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { evaluateInterviewSession } from "@/app/actions/evaluate";
import { requireUser } from "@/lib/auth";
import { fetchElevenLabsConversation, parseTurnsIntoQA } from "@/lib/elevenlabs";
import { prisma } from "@/lib/prisma";
import { startInterviewSchema, submitAnswerSchema } from "@/lib/validation";

export type StartInterviewFormState =
  | {
      fieldErrors?: {
        title?: string[];
        resumeId?: string[];
        jobDescriptionId?: string[];
        numQuestions?: string[];
        mode?: string[];
      };
      message?: string;
    }
  | undefined;

export async function startInterviewAction(
  _prev: StartInterviewFormState,
  formData: FormData,
): Promise<StartInterviewFormState> {
  const user = await requireUser("/interview/new");

  const parsed = startInterviewSchema.safeParse({
    title: formData.get("title"),
    resumeId: formData.get("resumeId"),
    jobDescriptionId: formData.get("jobDescriptionId"),
    numQuestions: Number(formData.get("numQuestions")),
    mode: formData.get("mode"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { title, resumeId, jobDescriptionId, numQuestions, mode } = parsed.data;

  // Ownership gate: both library entries must belong to this user (and not be
  // soft-deleted — the prisma extension's findFirst filter handles that).
  const [resumeRow, jdRow] = await Promise.all([
    prisma.resume.findFirst({ where: { id: resumeId, userId: user.id }, select: { id: true } }),
    prisma.jobDescription.findFirst({
      where: { id: jobDescriptionId, userId: user.id },
      select: { id: true },
    }),
  ]);

  if (!resumeRow) {
    return { fieldErrors: { resumeId: ["That resume isn't in your library."] } };
  }
  if (!jdRow) {
    return { fieldErrors: { jobDescriptionId: ["That job description isn't in your library."] } };
  }

  const session = await prisma.interviewSession.create({
    data: {
      userId: user.id,
      resumeId: resumeRow.id,
      jobDescriptionId: jdRow.id,
      questionCount: numQuestions,
      mode,
      // Voice sessions go through the /prepare page (planner LLM runs there)
      // before the candidate sees the call room. Text mode is still stubbed
      // and skips prep.
      status: mode === "text" ? "in_progress" : "pending",
    },
  });

  // The interview title is captured on the session indirectly via the JD/Resume
  // labels. For now we don't persist a session-level title override; when users
  // want one, add a `title` column back on interview_sessions in a later phase.
  void title;

  revalidatePath("/dashboard");
  redirect(mode === "voice" ? `/interview/${session.id}/prepare` : `/interview/${session.id}`);
}

export type SubmitAnswerResult =
  | { ok: true; completed: false; question: string; orderIndex: number }
  | { ok: true; completed: true; redirectTo: string }
  | { ok: false; message: string };

/**
 * NOT YET IMPLEMENTED POST-V2. Text-mode turn submission needs to be rebuilt
 * against TranscriptTurn + ReportCard. Stubbed so the build passes; see
 * prisma/migrations-plan.md for the next-session scope.
 */
export async function submitAnswerAction(input: {
  sessionId: string;
  answer: string;
}): Promise<SubmitAnswerResult> {
  await requireUser();
  const parsed = submitAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  return {
    ok: false,
    message: "Text-mode interviews are temporarily offline after the schema v2 migration. Use voice mode.",
  };
}

export type EndVoiceCallResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

/**
 * Fast path: fetch the ElevenLabs transcript, persist raw turns, mark session
 * COMPLETED. Evaluation (Phase 6) is kicked off via `after()` so the caller's
 * redirect isn't blocked on the multi-LLM scoring pass.
 */
export async function endVoiceCallAction(input: {
  sessionId: string;
  conversationId: string;
}): Promise<EndVoiceCallResult> {
  const user = await requireUser();

  const session = await prisma.interviewSession.findUnique({
    where: { id: input.sessionId },
  });

  if (!session || session.userId !== user.id) {
    return { ok: false, message: "Interview not found." };
  }

  if (session.status === "completed" || session.status === "completed_partial") {
    return { ok: true, redirectTo: `/dashboard/interview/${session.id}` };
  }

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: { elevenlabsConversationId: input.conversationId },
  });

  let conversation;
  try {
    conversation = await fetchElevenLabsConversation(input.conversationId);
  } catch (error) {
    console.error("fetchElevenLabsConversation failed", error);
    return {
      ok: false,
      message: "Couldn't pull the call transcript. Please try again in a minute.",
    };
  }

  const qa = parseTurnsIntoQA(conversation.transcript);

  if (qa.length === 0) {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: "abandoned" },
    });
    return { ok: false, message: "No answers were recorded during the call." };
  }

  // TranscriptTurn: one old Q/A pair becomes two rows (interviewer + candidate).
  await prisma.transcriptTurn.deleteMany({ where: { sessionId: session.id } });
  const turns: Array<{
    sessionId: string;
    turnIndex: number;
    speaker: "interviewer" | "candidate";
    content: string;
    startMs: number;
    endMs: number;
    questionIndex: number;
  }> = [];
  qa.forEach((pair, i) => {
    turns.push({
      sessionId: session.id,
      turnIndex: 2 * i,
      speaker: "interviewer",
      content: pair.question,
      startMs: 0,
      endMs: 0,
      questionIndex: i,
    });
    turns.push({
      sessionId: session.id,
      turnIndex: 2 * i + 1,
      speaker: "candidate",
      content: pair.answer,
      startMs: 0,
      endMs: 0,
      questionIndex: i,
    });
  });
  await prisma.transcriptTurn.createMany({ data: turns });

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      status: "completed",
      callEndedAt: new Date(),
    },
  });

  // Fire-and-forget — runs AFTER the redirect is sent, so the user lands on
  // the detail page immediately. The EvaluationPoller client polls and also
  // defensively kicks this if it somehow doesn't run (cold lambda, crash).
  after(async () => {
    await evaluateInterviewSession(session.id).catch((err) => {
      console.error("evaluateInterviewSession (after) failed", err);
    });
  });

  revalidatePath("/dashboard");
  return { ok: true, redirectTo: `/dashboard/interview/${session.id}` };
}

export type MarkStartedResult = { ok: true } | { ok: false; message: string };

/**
 * Called from the voice client the moment the WebRTC connection flips to
 * "connected". Transitions `ready → in_progress`, stamps callStartedAt, and
 * records the ElevenLabs conversation_id on the session. Idempotent: repeated
 * calls (StrictMode, reconnect) are a safe no-op as long as the session is
 * already in a later state.
 */
export async function markInterviewStartedAction(input: {
  sessionId: string;
  conversationId: string;
}): Promise<MarkStartedResult> {
  const user = await requireUser();
  const session = await prisma.interviewSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session || session.userId !== user.id) {
    return { ok: false, message: "Interview not found." };
  }
  if (session.mode !== "voice") {
    return { ok: false, message: "Voice-only transition." };
  }

  // Idempotent cases — already started or past.
  const isFinal =
    session.status === "completed" ||
    session.status === "completed_partial" ||
    session.status === "failed" ||
    session.status === "abandoned";
  if (isFinal) return { ok: true };

  if (session.status === "in_progress") {
    // Backfill the conversationId if we somehow lost it earlier but don't
    // stomp a value that's already set.
    if (!session.elevenlabsConversationId && input.conversationId) {
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: { elevenlabsConversationId: input.conversationId },
      });
    }
    return { ok: true };
  }

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      status: "in_progress",
      callStartedAt: new Date(),
      elevenlabsConversationId: input.conversationId,
    },
  });

  revalidatePath(`/dashboard/interview/${session.id}`);
  return { ok: true };
}

