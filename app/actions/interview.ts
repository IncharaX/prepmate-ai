"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  evaluateInterviewAnswer,
  generateInterviewQuestion,
  generateInterviewSummary,
} from "@/lib/ai";
import { fetchElevenLabsConversation, parseTurnsIntoQA } from "@/lib/elevenlabs";
import { prisma } from "@/lib/prisma";
import { startInterviewSchema, submitAnswerSchema } from "@/lib/validation";

export type StartInterviewFormState = {
  fieldErrors?: {
    title?: string[];
    jdText?: string[];
    resume?: string[];
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
    resume: formData.get("resume"),
    numQuestions: Number(formData.get("numQuestions")),
    mode: formData.get("mode"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { title, jdText, resume, numQuestions, mode } = parsed.data;

  const session = await prisma.interviewSession.create({
    data: {
      userId: user.id,
      title,
      domain: "JD-based Interview",
      resumeText: jdText,
      resume,
      plannedQuestions: numQuestions,
      mode,
    },
  });

  // For text mode, pre-generate the first question so the [id] page has one to show.
  // Voice mode is handled by ElevenLabs — no pre-generation needed.
  if (mode === "TEXT") {
    try {
      const generated = await generateInterviewQuestion(jdText);
      await prisma.interviewResult.create({
        data: {
          sessionId: session.id,
          order: 0,
          question: generated.question,
          answer: "",
          contentScore: 0,
          communicationScore: 0,
          confidenceScore: 0,
          feedback: "",
        },
      });
    } catch (error) {
      console.error("Failed to generate first question", error);
      // Clean up the orphaned session.
      await prisma.interviewSession.delete({ where: { id: session.id } });
      return { message: "Maya couldn't start right now. Please try again in a moment." };
    }
  }

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
      resume: session.resume ?? undefined,
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

export type EndVoiceCallResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

/**
 * Fast path: fetch the ElevenLabs transcript, persist raw Q/A pairs with placeholder
 * scores, mark session COMPLETED, return redirect. Scoring + summary run separately
 * via scoreVoiceSessionAction so the UI doesn't hang on minutes of serial LLM calls.
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

  if (session.status === "COMPLETED") {
    return { ok: true, redirectTo: `/dashboard/interview/${session.id}` };
  }

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: { elevenLabsConvId: input.conversationId },
  });

  let conversation;
  try {
    conversation = await fetchElevenLabsConversation(input.conversationId);
  } catch (error) {
    console.error("fetchElevenLabsConversation failed", error);
    return { ok: false, message: "Couldn't pull the call transcript. Please try again in a minute." };
  }

  const qa = parseTurnsIntoQA(conversation.transcript);

  if (qa.length === 0) {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: "ABANDONED" },
    });
    return { ok: false, message: "No answers were recorded during the call." };
  }

  await prisma.interviewResult.deleteMany({ where: { sessionId: session.id } });
  await prisma.interviewResult.createMany({
    data: qa.map((pair, i) => ({
      sessionId: session.id,
      order: i,
      question: pair.question,
      answer: pair.answer,
      contentScore: 0,
      communicationScore: 0,
      confidenceScore: 0,
      feedback: "",
    })),
  });

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  revalidatePath("/dashboard");
  return { ok: true, redirectTo: `/dashboard/interview/${session.id}` };
}

export type ScoreVoiceSessionResult = { ok: true } | { ok: false; message: string };

/**
 * Idempotent: exits immediately if summary is already set. Parallelizes per-turn
 * evaluation via Promise.allSettled so one slow/failed LLM call doesn't stall the
 * rest. Writes scores + feedback per row, generates final summary.
 */
export async function scoreVoiceSessionAction(
  sessionId: string,
): Promise<ScoreVoiceSessionResult> {
  const user = await requireUser();

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: { results: { orderBy: { order: "asc" } } },
  });

  if (!session || session.userId !== user.id) {
    return { ok: false, message: "Interview not found." };
  }

  if (session.summary) {
    return { ok: true };
  }

  const qa = session.results
    .filter((r) => r.answer !== "")
    .map((r) => ({ id: r.id, question: r.question, answer: r.answer }));

  if (qa.length === 0) {
    return { ok: false, message: "No answers to score." };
  }

  type Scored = {
    id: string;
    question: string;
    answer: string;
    contentScore: number;
    communicationScore: number;
    confidenceScore: number;
    feedback: string;
    evaluated: boolean;
  };

  const scored: Scored[] = await runWithConcurrency(
    qa,
    3,
    async (pair, i) => {
      const history = qa.slice(0, i).map(({ question, answer }) => ({ question, answer }));
      const attempt = () =>
        evaluateInterviewAnswer({
          jdText: session.resumeText,
          resume: session.resume ?? undefined,
          question: pair.question,
          answer: pair.answer,
          history,
          shouldAskNextQuestion: false,
        });

      try {
        const evalResult = await attempt();
        return {
          id: pair.id,
          question: pair.question,
          answer: pair.answer,
          contentScore: evalResult.score.content,
          communicationScore: evalResult.score.communication,
          confidenceScore: evalResult.score.confidence,
          feedback: evalResult.feedback,
          evaluated: true,
        };
      } catch (firstError) {
        console.warn(
          `evaluateInterviewAnswer failed for turn ${i} (first attempt)`,
          firstError instanceof Error ? firstError.message : firstError,
        );
        await new Promise((r) => setTimeout(r, 750 + Math.random() * 750));
        try {
          const evalResult = await attempt();
          return {
            id: pair.id,
            question: pair.question,
            answer: pair.answer,
            contentScore: evalResult.score.content,
            communicationScore: evalResult.score.communication,
            confidenceScore: evalResult.score.confidence,
            feedback: evalResult.feedback,
            evaluated: true,
          };
        } catch (secondError) {
          console.error(
            `evaluateInterviewAnswer failed for turn ${i} (retry)`,
            secondError instanceof Error ? secondError.message : secondError,
          );
          return {
            id: pair.id,
            question: pair.question,
            answer: pair.answer,
            contentScore: 0,
            communicationScore: 0,
            confidenceScore: 0,
            feedback: "",
            evaluated: false,
          };
        }
      }
    },
  );

  await Promise.all(
    scored.map((row) =>
      prisma.interviewResult.update({
        where: { id: row.id },
        data: {
          contentScore: row.contentScore,
          communicationScore: row.communicationScore,
          confidenceScore: row.confidenceScore,
          feedback: row.feedback,
        },
      }),
    ),
  );

  const successCount = scored.filter((r) => r.evaluated).length;
  const mostlyFailed = successCount < Math.ceil(scored.length / 2);

  let summary;
  if (mostlyFailed) {
    console.error(
      `scoring mostly failed for session ${sessionId}: ${successCount}/${scored.length} turns evaluated`,
    );
    summary = {
      summary:
        "We couldn't grade this session reliably — too many of Maya's evaluation calls failed. The full transcript is below. Try running another interview; if this keeps happening, your AI provider may be rate-limiting requests.",
      overallScore: 0,
      strengths: [],
      improvements: [],
      partial: true,
      successCount,
      totalTurns: scored.length,
    };
  } else {
    try {
      const generated = await generateInterviewSummary({
        jdText: session.resumeText,
        title: session.title,
        transcript: scored.filter((r) => r.evaluated),
      });
      summary = {
        ...generated,
        partial: successCount < scored.length,
        successCount,
        totalTurns: scored.length,
      };
    } catch (error) {
      console.error("summary generation failed", error);
      const evaluatedRows = scored.filter((r) => r.evaluated);
      const avg = Math.round(
        evaluatedRows.reduce(
          (acc, r) => acc + (r.contentScore + r.communicationScore + r.confidenceScore) / 3,
          0,
        ) / Math.max(evaluatedRows.length, 1),
      );
      summary = {
        summary:
          "Your transcript is saved below. Maya couldn't write a summary this time — the AI provider may be temporarily unavailable.",
        overallScore: avg,
        strengths: [],
        improvements: [],
        partial: true,
        successCount,
        totalTurns: scored.length,
      };
    }
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { summary },
  });

  revalidatePath(`/dashboard/interview/${sessionId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Runs an async mapper over items with bounded concurrency, preserving input order.
 * We use this for per-turn LLM scoring so we don't hammer OpenRouter with N parallel
 * requests and get rate-limited into silent failures.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
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
