const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

function requireElevenLabsEnv() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be configured.");
  }
  return { apiKey, agentId };
}

export async function getElevenLabsSignedUrl() {
  const { apiKey, agentId } = requireElevenLabsEnv();
  let res: Response;
  try {
    res = await fetch(`${ELEVENLABS_API}/convai/conversation/get-signed-url?agent_id=${agentId}`, {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("ElevenLabs signed-url request timed out.");
    }
    throw error;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs signed-url error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { signed_url?: string };
  if (!data.signed_url) {
    throw new Error("ElevenLabs signed-url response missing signed_url.");
  }
  return { signedUrl: data.signed_url, agentId };
}

export type ElevenLabsConversationTranscript = {
  conversation_id: string;
  status?: string;
  transcript?: Array<{
    role: "user" | "agent";
    message?: string | null;
    time_in_call_secs?: number;
  }>;
};

export async function fetchElevenLabsConversation(conversationId: string) {
  const { apiKey } = requireElevenLabsEnv();

  // ElevenLabs finalizes the transcript shortly after the call ends. Poll briefly.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    let res: Response | null = null;
    try {
      res = await fetch(`${ELEVENLABS_API}/convai/conversations/${conversationId}`, {
        headers: { "xi-api-key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // Network hiccup or per-request timeout — retry until the outer deadline.
      if (!(error instanceof DOMException && error.name === "TimeoutError")) {
        console.warn("ElevenLabs transcript fetch warning", error);
      }
    }

    if (res?.ok) {
      const data = (await res.json()) as ElevenLabsConversationTranscript;
      const done = data.status && ["done", "completed", "finalized"].includes(data.status.toLowerCase());
      if (done || (data.transcript && data.transcript.length > 0)) return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Timed out waiting for ElevenLabs conversation transcript.");
}

/**
 * Truncate to at most `max` characters, cutting at the last whitespace boundary
 * when possible. Returns the original string unchanged if it's already short
 * enough. When truncation happens, appends `"… [truncated]"` so the LLM knows
 * the input was abbreviated rather than the candidate being terse.
 */
export function truncateAtWord(text: string, max: number): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= max) return trimmed;

  // Try to break at the last whitespace within the limit. Leave ≥80% of the
  // budget intact so we don't end up with a ridiculously short fragment when
  // the last space happens to be near the start.
  const hardCut = trimmed.slice(0, max);
  const lastSpace = hardCut.search(/\s\S*$/);
  const minKeep = Math.floor(max * 0.8);
  const cutAt = lastSpace >= minKeep ? lastSpace : max;
  return `${trimmed.slice(0, cutAt).trimEnd()}… [truncated]`;
}

export type TranscriptTurn = { role: "user" | "agent"; message: string };

export function parseTurnsIntoQA(
  transcript: ElevenLabsConversationTranscript["transcript"] = [],
): Array<{ question: string; answer: string }> {
  const turns = (transcript ?? []).filter(
    (t): t is TranscriptTurn =>
      (t.role === "user" || t.role === "agent") && typeof t.message === "string" && t.message.trim().length > 0,
  );

  const pairs: Array<{ question: string; answer: string }> = [];
  let pendingQuestion: string | null = null;

  for (const turn of turns) {
    if (turn.role === "agent") {
      pendingQuestion = turn.message.trim();
    } else if (turn.role === "user" && pendingQuestion) {
      pairs.push({ question: pendingQuestion, answer: turn.message.trim() });
      pendingQuestion = null;
    }
  }

  return pairs;
}
