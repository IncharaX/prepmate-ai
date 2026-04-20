/**
 * Single LLM call wrapper. All non-stub LLM traffic from the app should go
 * through this function so every call lands in `llm_calls` with prompt,
 * response, tokens, cost, latency, and success flag — no silent failures.
 *
 * Points at OpenAI's chat completions API directly. OpenRouter attribution
 * headers (HTTP-Referer, X-Title) were dropped with the provider switch —
 * OpenAI ignores them.
 */
import { z } from "zod";

import { prismaAdmin } from "@/lib/prisma"; // why: we want the log written even if the calling code forgets to handle soft-delete filters; admin bypasses nothing that matters here (llm_calls has no deletedAt)
import { estimateCostUsd } from "@/lib/llm-pricing";
import type { LlmPurpose } from "./generated/prisma/enums";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const PROVIDER = "openai";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCallSuccess<T> = { ok: true; data: T; callId: string };
export type LlmCallFailure = { ok: false; error: string; callId: string | null };
export type LlmCallResult<T> = LlmCallSuccess<T> | LlmCallFailure;

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type OpenAiResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenAiUsage;
  error?: { message?: string };
};

export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCallError";
  }
}

export async function callLlmJson<T>(opts: {
  purpose: LlmPurpose;
  model: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  userId?: string | null;
  sessionId?: string | null;
  temperature?: number;
  timeoutMs?: number;
}): Promise<LlmCallResult<T>> {
  const { purpose, model, messages, schema } = opts;
  const temperature = opts.temperature ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENAI_API_KEY is not configured.",
      callId: null,
    };
  }

  const startedAt = Date.now();
  let responseText: string | null = null;
  let usage: OpenAiUsage | undefined;
  let callError: string | null = null;
  let statusCode: number | null = null;

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        response_format: { type: "json_object" },
      }),
    });

    statusCode = response.status;
    const payload = (await response.json().catch(() => null)) as OpenAiResponse | null;
    usage = payload?.usage;

    if (!response.ok) {
      callError = payload?.error?.message ?? `OpenAI ${response.status}`;
    } else {
      responseText = payload?.choices?.[0]?.message?.content ?? null;
      if (!responseText) callError = "OpenAI returned empty content.";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      callError = `OpenAI timed out after ${timeoutMs}ms.`;
    } else {
      callError = error instanceof Error ? error.message : String(error);
    }
  }

  let parsed: T | null = null;
  let parseError: string | null = null;
  if (responseText && !callError) {
    const jsonResult = safeExtractJson(responseText);
    if (!jsonResult.ok) {
      parseError = jsonResult.error;
    } else {
      const zodResult = schema.safeParse(jsonResult.value);
      if (!zodResult.success) {
        parseError = zodResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } else {
        parsed = zodResult.data;
      }
    }
  }

  const finalError = callError ?? parseError;
  const latencyMs = Date.now() - startedAt;
  const inputTokens = usage?.prompt_tokens ?? null;
  const outputTokens = usage?.completion_tokens ?? null;
  const costUsd = estimateCostUsd({ model, inputTokens, outputTokens });

  let callId: string | null = null;
  try {
    const row = await prismaAdmin.llmCall.create({
      data: {
        sessionId: opts.sessionId ?? null,
        userId: opts.userId ?? null,
        purpose,
        model,
        provider: PROVIDER,
        prompt: messages as unknown as object,
        response: responseText ? { content: responseText, statusCode } : undefined,
        inputTokens,
        outputTokens,
        costUsd: costUsd ?? undefined,
        latencyMs,
        succeeded: !finalError && parsed !== null,
        errorMessage: finalError ? finalError.slice(0, 500) : null,
        attemptNumber: 1,
      },
      select: { id: true },
    });
    callId = row.id;
  } catch (logError) {
    // Don't let a log-write failure mask the actual call outcome.
    console.error("[llm] failed to persist LlmCall row", logError);
  }

  if (finalError || parsed === null) {
    return { ok: false, error: finalError ?? "Unknown LLM failure.", callId };
  }
  return { ok: true, data: parsed, callId: callId ?? "" };
}

function safeExtractJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // Try stripping ``` fences or hunting for the outermost { ... } block.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    if (!candidate || !candidate.startsWith("{")) {
      return { ok: false, error: "LLM response did not contain JSON." };
    }
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? `JSON parse: ${error.message}` : "JSON parse failed.",
      };
    }
  }
}
