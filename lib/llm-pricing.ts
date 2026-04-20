/**
 * Per-model pricing (USD per 1M tokens).
 *
 * Kept as a static map rather than an API call — we only hit a handful of
 * models and the rates change quarterly at most. Update when OpenAI changes
 * pricing or we onboard a new model.
 *
 * Source: https://openai.com/api/pricing/ (publicly-listed pricing as of commit).
 * Legacy OpenRouter-style slugs (with provider prefix) kept in case we ever
 * route through OpenRouter again — harmless when unused.
 */
export type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

export const PRICING: Readonly<Record<string, ModelPricing>> = {
  // OpenAI direct (what we use today — `gpt-4o`, `gpt-4o-mini`, etc. without provider prefix)
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // Legacy OpenRouter-style slugs (unused today; harmless to keep)
  "openai/gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "anthropic/claude-sonnet-4.5": { inputPer1M: 3, outputPer1M: 15 },
  "anthropic/claude-haiku-4.5": { inputPer1M: 0.8, outputPer1M: 4 },
  "anthropic/claude-3.5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "meta-llama/llama-3.1-8b-instruct": { inputPer1M: 0.055, outputPer1M: 0.055 },
};

const warnedModels = new Set<string>();

/**
 * Best-effort cost estimate. Returns null if we don't know the model's rate.
 * Logs a one-time warning per unknown model so the operator notices drift.
 */
export function estimateCostUsd(params: {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}): string | null {
  const rates = PRICING[params.model];
  if (!rates) {
    if (!warnedModels.has(params.model)) {
      warnedModels.add(params.model);
      console.warn(
        `[llm-pricing] No rate for "${params.model}" — cost_usd will be null. Add it to lib/llm-pricing.ts.`,
      );
    }
    return null;
  }
  const input = params.inputTokens ?? 0;
  const output = params.outputTokens ?? 0;
  if (input === 0 && output === 0) return null;
  const cost = (input * rates.inputPer1M) / 1_000_000 + (output * rates.outputPer1M) / 1_000_000;
  // Prisma Decimal(10,6) — 6 fractional digits covers everything cheaper than $10 per call.
  return cost.toFixed(6);
}
