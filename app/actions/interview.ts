"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  evaluateInterviewAnswer,
  generateInterviewQuestion,
  generateInterviewSummary,
} from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { startInterviewSchema, submitAnswerSchema } from "@/lib/validation";

export type StartInterviewFormState = {
  fieldErrors?: {
    title?: string[];
    jdText?: string[];
    numQuestions?: string[];
    mode?: string[];
  };
  message?: string;
} | undefined;

export async function startInterviewAction(
  _prev: StartInterviewFormState,
  formData: FormData,
): Promise<StartInterviewFormState> {
  const user = await requireUser("/interview/new");

  const parsed = startInterviewSchema.safeParse({
    title: formData.get("title"),
    jdText: formData.get("jdText"),
    numQuestions: Number(formData.get("numQuestions")),
    mode: formData.get("mode"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { title, jdText, numQuestions, mode } = parsed.data;

  let question: string;
  try {
    const generated = await generateInterviewQuestion(jdText);
    question = generated.question;
  } catch (error) {
    console.error("Failed to generate first question", error);
    return { message: "Maya couldn't start right now. Please try again in a moment." };
  }

  const session = await prisma.interviewSession.create({
    data: {
      userId: user.id,
      title,
      domain: "JD-based Interview",
      resumeText: jdText,
      plannedQuestions: numQuestions,
      mode,
    },
  });

  await prisma.interviewResult.create({
    data: {
      sessionId: session.id,
      order: 0,
      question,
      answer: "",
      contentScore: 0,
      communicationScore: 0,
      confidenceScore: 0,
      feedback: "",
    },
  });

  revalidatePath("/dashboard");
  redirect(`/interview/${session.id}`);
}

export type SubmitAnswerResult =
  | { ok: true; completed: false; question: string; orderIndex: number }
  | { ok: true; completed: true; redirectTo: string }
  | { ok: false; message: string };

export async function submitAnswerAction(input: {
  sessionId: string;
  answer: string;
}): Promise<SubmitAnswerResult> {
  const user = await requireUser();

  const parsed = submitAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { sessionId, answer } = parsed.data;

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: { results: { orderBy: { order: "asc" } } },
  });

  if (!session || session.userId !== user.id) {
    return { ok: false, message: "Interview not found." };
  }

  if (session.status === "COMPLETED") {
    return { ok: true, completed: true, redirectTo: `/dashboard/interview/${session.id}` };
  }

  const pending = session.results.find((r) => r.answer === "");
  if (!pending) {
    return { ok: false, message: "No active question. Please refresh." };
  }

  const answeredHistory = session.results
    .filter((r) => r.answer !== "")
    .map((r) => ({ question: r.question, answer: r.answer }));

  const answeredCount = answeredHistory.length + 1;
  const shouldAskNextQuestion = answeredCount < session.plannedQuestions;

  let evaluation;
  try {
    evaluation = await evaluateInterviewAnswer({
      jdText: session.resumeText,
      question: pending.question,
      answer,
      history: answeredHistory,
      shouldAskNextQuestion,
    });
  } catch (error) {
    console.error("evaluateInterviewAnswer failed", error);
    return { ok: false, message: "Maya couldn't score that answer. Please try again." };
  }

  await prisma.interviewResult.update({
    where: { id: pending.id },
    data: {
      answer,
      contentScore: evaluation.score.content,
      communicationScore: evaluation.score.communication,
      confidenceScore: evaluation.score.confidence,
      feedback: evaluation.feedback,
    },
  });

  if (!shouldAskNextQuestion) {
    const finalResults = await prisma.interviewResult.findMany({
      where: { sessionId: session.id },
      orderBy: { order: "asc" },
    });

    let summary;
    try {
      summary = await generateInterviewSummary({
        jdText: session.resumeText,
        title: session.title,
        transcript: finalResults.map((r) => ({
          question: r.question,
          answer: r.answer,
          contentScore: r.contentScore,
          communicationScore: r.communicationScore,
          confidenceScore: r.confidenceScore,
          feedback: r.feedback,
        })),
      });
    } catch (error) {
      console.error("generateInterviewSummary failed", error);
      summary = {
        summary:
          "Your session is saved. Maya couldn't auto-generate a summary this time — review your per-answer feedback below.",
        overallScore: Math.round(
          finalResults.reduce(
            (acc, r) => acc + (r.contentScore + r.communicationScore + r.confidenceScore) / 3,
            0,
          ) / Math.max(finalResults.length, 1),
        ),
        strengths: [],
        improvements: [],
      };
    }

    await prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        summary,
      },
    });

    revalidatePath("/dashboard");
    return { ok: true, completed: true, redirectTo: `/dashboard/interview/${session.id}` };
  }

  const nextQuestionText = evaluation.nextQuestion ?? "";
  if (!nextQuestionText) {
    return { ok: false, message: "Maya didn't return a next question. Please try again." };
  }

  const nextOrder = pending.order + 1;
  await prisma.interviewResult.create({
    data: {
      sessionId: session.id,
      order: nextOrder,
      question: nextQuestionText,
      answer: "",
      contentScore: 0,
      communicationScore: 0,
      confidenceScore: 0,
      feedback: "",
    },
  });

  return { ok: true, completed: false, question: nextQuestionText, orderIndex: nextOrder };
}

export async function abandonInterviewAction(sessionId: string) {
  const user = await requireUser();
  const session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== user.id) return;
  if (session.status !== "IN_PROGRESS") return;
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "ABANDONED" },
  });
  revalidatePath("/dashboard");
}
