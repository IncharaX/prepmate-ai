import { AIResponseError, evaluateInterviewAnswer, generateInterviewQuestion } from "@/lib/ai";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_INTERVIEW_QUESTIONS = 8;
const JD_SESSION_LABEL = "JD-based Interview";

type InterviewRequestBody = {
  domain?: unknown;
  jdText?: unknown;
  resumeText?: unknown;
  answer?: unknown;
  question?: unknown;
  sessionId?: unknown;
};

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(`${field} is required and must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value.trim();
}

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

async function getDemoUser() {
  return prisma.user.upsert({
    where: {
      email: "demo@prepmate.ai",
    },
    update: {},
    create: {
      name: "Demo Candidate",
      email: "demo@prepmate.ai",
    },
  });
}

async function persistSession(resumeText: string) {
  const user = await getDemoUser();

  return prisma.interviewSession.create({
    data: {
      userId: user.id,
      domain: JD_SESSION_LABEL,
      resumeText,
    },
  });
}

async function persistResult(params: {
  sessionId?: string;
  resumeText: string;
  question: string;
  answer: string;
  contentScore: number;
  communicationScore: number;
  confidenceScore: number;
  feedback: string;
}) {
  const session =
    params.sessionId
      ? await prisma.interviewSession.findUnique({
          where: {
            id: params.sessionId,
          },
          include: {
            results: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        })
      : await persistSession(params.resumeText);

  if (!session) {
    throw new RequestValidationError("Interview session was not found.");
  }

  return prisma.interviewResult.create({
    data: {
      sessionId: session.id,
      question: params.question,
      answer: params.answer,
      contentScore: params.contentScore,
      communicationScore: params.communicationScore,
      confidenceScore: params.confidenceScore,
      feedback: params.feedback,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InterviewRequestBody;
    const resumeText = readRequiredString(body.jdText ?? body.resumeText, "jdText");

    const answer = readOptionalString(body.answer);

    if (!answer) {
      const result = await generateInterviewQuestion(resumeText);
      const session = await persistSession(resumeText).catch((error: unknown) => {
        console.error("Failed to persist interview session", error);
        return null;
      });

      return Response.json({
        ...result,
        ...(session ? { sessionId: session.id } : {}),
      });
    }

    const sessionId = readOptionalString(body.sessionId);
    const previousResults = sessionId
      ? await prisma.interviewResult.findMany({
          where: {
            sessionId,
          },
          orderBy: {
            createdAt: "asc",
          },
        }).catch((error: unknown) => {
          console.error("Failed to load interview history", error);
          return [];
        })
      : [];
    const shouldAskNextQuestion = previousResults.length + 1 < MAX_INTERVIEW_QUESTIONS;
    const result = await evaluateInterviewAnswer({
      jdText: resumeText,
      answer,
      question: readOptionalString(body.question),
      shouldAskNextQuestion,
      history: previousResults.map((previousResult) => ({
        question: previousResult.question,
        answer: previousResult.answer,
      })),
    });

    await persistResult({
      sessionId,
      resumeText,
      question: result.question,
      answer,
      contentScore: result.score.content,
      communicationScore: result.score.communication,
      confidenceScore: result.score.confidence,
      feedback: result.feedback,
    }).catch((error: unknown) => {
      console.error("Failed to persist interview result", error);
    });

    return Response.json({
      ...result,
      sessionComplete: !result.nextQuestion,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (error instanceof RequestValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof AIResponseError) {
      return Response.json({ error: error.message }, { status: 502 });
    }

    console.error("Interview API error", error);
    return Response.json({ error: "Failed to process interview request." }, { status: 500 });
  }
}
