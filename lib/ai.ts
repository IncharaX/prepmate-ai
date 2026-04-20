const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export type InterviewQuestionResponse = {
  question: string;
};

export type InterviewEvaluationResponse = {
  question: string;
  score: {
    content: number;
    communication: number;
    confidence: number;
  };
  feedback: string;
  nextQuestion?: string;
};

export type InterviewSummaryResponse = {
  summary: string;
  overallScore: number;
  strengths: string[];
  improvements: string[];
};

export class AIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIResponseError";
  }
}

async function callOpenRouter(messages: ChatMessage[]) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new AIResponseError("OPENROUTER_API_KEY is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "PrepMate AI",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        messages,
        temperature: 0.3,
        response_format: {
          type: "json_object",
        },
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AIResponseError("OpenRouter request timed out after 60s.");
    }
    throw new AIResponseError(
      error instanceof Error ? `OpenRouter network error: ${error.message}` : "OpenRouter network error.",
    );
  }

  const payload = (await response.json().catch(() => null)) as OpenRouterResponse | null;

  if (!response.ok) {
    throw new AIResponseError(payload?.error?.message ?? "OpenRouter request failed.");
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (!content) {
    throw new AIResponseError("OpenRouter returned an empty response.");
  }

  return content;
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);

    if (!candidate || !candidate.startsWith("{")) {
      throw new AIResponseError("AI response did not contain valid JSON.");
    }

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      throw new AIResponseError("AI response JSON could not be parsed.");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(10, Math.max(0, Math.round(score)));
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AIResponseError(`AI response is missing "${field}".`);
  }

  return value.trim();
}

function parseQuestionResponse(raw: string): InterviewQuestionResponse {
  const parsed = extractJsonObject(raw);

  if (!isRecord(parsed)) {
    throw new AIResponseError("AI response must be a JSON object.");
  }

  return {
    question: readString(parsed.question, "question"),
  };
}

function parseEvaluationResponse(raw: string, fallbackQuestion?: string): InterviewEvaluationResponse {
  const parsed = extractJsonObject(raw);

  if (!isRecord(parsed) || !isRecord(parsed.score)) {
    throw new AIResponseError("AI response must include a score object.");
  }

  const nextQuestion = typeof parsed.nextQuestion === "string" && parsed.nextQuestion.trim() ? parsed.nextQuestion.trim() : undefined;

  return {
    question: typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : readString(fallbackQuestion, "question"),
    score: {
      content: clampScore(parsed.score.content),
      communication: clampScore(parsed.score.communication),
      confidence: clampScore(parsed.score.confidence),
    },
    feedback: readString(parsed.feedback, "feedback"),
    ...(nextQuestion ? { nextQuestion } : {}),
  };
}

export async function generateInterviewQuestion(
  jdText: string,
  history: Array<{ question: string; answer: string }> = [],
  resume?: string,
) {
  const content = await callOpenRouter([
    {
      role: "system",
      content:
        "You are Maya from PrepMate AI, a warm, sharp HR interviewer. You sound alive, conversational, and professional. Ask one realistic interview question at a time, grounded in the JD, the candidate's resume, and prior answers. Mix behavioral, motivation, role-fit, communication, scenario, and technical-screening questions. Do not reveal question counts. Return only valid JSON. Do not include markdown, code fences, or commentary.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Generate the next HR-style interview question for this candidate. Make it specific to the JD and the candidate's background.",
        jobDescription: jdText,
        candidateResume: resume ?? "",
        previousQuestionsAndAnswers: history,
        outputSchema: {
          question: "string",
        },
      }),
    },
  ]);

  return parseQuestionResponse(content);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 6);
}

function parseSummaryResponse(raw: string): InterviewSummaryResponse {
  const parsed = extractJsonObject(raw);

  if (!isRecord(parsed)) {
    throw new AIResponseError("AI summary response must be a JSON object.");
  }

  return {
    summary: readString(parsed.summary, "summary"),
    overallScore: clampScore(parsed.overallScore),
    strengths: toStringArray(parsed.strengths),
    improvements: toStringArray(parsed.improvements),
  };
}

export async function generateInterviewSummary(params: {
  jdText: string;
  title: string;
  transcript: Array<{
    question: string;
    answer: string;
    contentScore: number;
    communicationScore: number;
    confidenceScore: number;
    feedback: string;
  }>;
}): Promise<InterviewSummaryResponse> {
  const content = await callOpenRouter([
    {
      role: "system",
      content:
        "You are Maya, a warm but discerning HR interviewer wrapping up a mock interview. Write a concise post-interview report for the candidate. Return only valid JSON. Do not include markdown, code fences, or commentary.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Write a final report based on the entire transcript and per-turn scores. Be specific, actionable, and grounded in the candidate's actual answers. The summary should be 3-5 sentences. Strengths and improvements should be 2-4 items each, short and concrete.",
        interviewTitle: params.title,
        jobDescription: params.jdText,
        transcript: params.transcript,
        outputSchema: {
          summary: "string (3-5 sentences, second person)",
          overallScore: "integer 0-10",
          strengths: "array of short strings",
          improvements: "array of short strings",
        },
      }),
    },
  ]);

  return parseSummaryResponse(content);
}

export async function evaluateInterviewAnswer(params: {
  jdText: string;
  answer: string;
  question?: string;
  resume?: string;
  shouldAskNextQuestion?: boolean;
  history?: Array<{ question: string; answer: string }>;
}) {
  const content = await callOpenRouter([
    {
      role: "system",
      content:
        "You are Maya from PrepMate AI, a warm but discerning HR interviewer. Evaluate honestly, coach briefly, and keep the interview moving like a real HR screen. Ground every next question in the JD and the candidate's resume. Return only valid JSON. Scores must be integers from 0 to 10. Do not reveal question counts or internal limits.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Evaluate the candidate answer. If shouldAskNextQuestion is true, also ask the next natural HR-style interview question grounded in the JD and resume. If false, do not ask another question.",
        jobDescription: params.jdText,
        candidateResume: params.resume ?? "",
        question: params.question,
        answer: params.answer,
        previousQuestionsAndAnswers: params.history ?? [],
        shouldAskNextQuestion: params.shouldAskNextQuestion ?? false,
        outputSchema: {
          question: "string",
          score: {
            content: "number from 0 to 10",
            communication: "number from 0 to 10",
            confidence: "number from 0 to 10",
          },
          feedback: "string",
          nextQuestion: "string, only when shouldAskNextQuestion is true",
        },
      }),
    },
  ]);

  return parseEvaluationResponse(content, params.question);
}
