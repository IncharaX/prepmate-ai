import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { getElevenLabsSignedUrl, truncateAtWord } from "@/lib/elevenlabs";
import { prisma } from "@/lib/prisma";
import {
  formatQuestionPlanForAgent,
  plannerResponseSchema,
  type PlannerResponse,
} from "@/lib/prompts/planner";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.string().uuid({ message: "Invalid sessionId." }),
});

const JD_MAX = 3000;
const RESUME_MAX = 3000;
const QUESTION_PLAN_MAX = 2000;

/**
 * Mint a one-shot signed URL + the dynamic variables that fill Maya's prompt
 * for THIS session's call. Composition happens server-side so we (a) truncate
 * JD/resume to a budget the prompt can hold, (b) never hand over someone
 * else's session data, (c) keep the large strings off the client bundle when
 * the page is rendered.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid sessionId." },
      { status: 400 },
    );
  }

  const session = await prisma.interviewSession.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id },
    include: { resume: true, jobDescription: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  if (session.mode !== "voice") {
    return NextResponse.json({ error: "Voice mode only." }, { status: 409 });
  }

  if (session.status === "pending") {
    return NextResponse.json(
      { error: "Interview is still preparing. Refresh once prep finishes." },
      { status: 409 },
    );
  }

  if (session.status === "failed") {
    return NextResponse.json(
      { error: "Interview prep failed. Retry from the prepare page." },
      { status: 409 },
    );
  }

  const finalStatuses = ["completed", "completed_partial", "abandoned"];
  if (finalStatuses.includes(session.status)) {
    return NextResponse.json({ error: "Interview already ended." }, { status: 409 });
  }

  const candidateName = pickCandidateName({ name: user.name, email: user.email });
  const interviewTitle = session.jobDescription.label?.trim() || "HR Screen";

  // Derived from the planner output (Phase 5). If prep somehow didn't run,
  // pass an empty string so the agent prompt interpolates cleanly — Maya will
  // still have JD + resume and can improvise.
  const questionPlan = extractQuestionPlan(session.prepData);

  const dynamicVariables: Record<string, string> = {
    candidate_name: candidateName,
    interview_title: interviewTitle,
    planned_questions: String(session.questionCount),
    jd: truncateAtWord(session.jobDescription.rawText, JD_MAX),
    resume: truncateAtWord(session.resume.extractedText, RESUME_MAX),
    question_plan: questionPlan,
  };

  let signedUrl: string;
  try {
    ({ signedUrl } = await getElevenLabsSignedUrl());
  } catch (error) {
    console.error("signed-url provisioning failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  return NextResponse.json({ signedUrl, dynamicVariables });
}

function pickCandidateName({ name, email }: { name?: string | null; email?: string | null }): string {
  const first = name?.trim().split(/\s+/)[0];
  if (first) return first;
  const prefix = email?.split("@")[0]?.trim();
  if (prefix) return prefix;
  return "there";
}

function extractQuestionPlan(prepData: unknown): string {
  if (!prepData || typeof prepData !== "object") return "";
  const parsed = plannerResponseSchema.safeParse(prepData);
  if (!parsed.success) return "";
  return formatQuestionPlanForAgent(
    (parsed.data as PlannerResponse).questionPlan,
    QUESTION_PLAN_MAX,
  );
}
