/**
 * Pure heuristic: which interviewer turns are "real questions," and what
 * question index does every turn belong to?
 *
 * Contract:
 * - Input is the full, turn-ordered list of transcript turns for a session.
 * - Output is a list of "real question" turn IDs (in turn-index order) and a
 *   map assigning a `questionIndex` to EVERY turn (interviewer + candidate).
 *
 * Heuristic:
 * 1. Take interviewer turns whose content is ≥ MIN_QUESTION_CHARS. These are
 *    long enough to be real questions rather than back-channels ("got it",
 *    "mm-hmm", "interesting").
 * 2. If we have ≥ expectedCount such turns, keep the first `expectedCount` in
 *    turn-index order.
 * 3. Otherwise fall back: take the top-`expectedCount` interviewer turns by
 *    content length (descending), then re-sort by turnIndex.
 * 4. Walk every turn in order, incrementing a running question index each
 *    time we hit a chosen turn. Turns before the first chosen turn map to
 *    question 0 (warmup chatter). Turns after the last chosen turn inherit
 *    the last index (wrap-up).
 */
export type MappableTurn = {
  id: string;
  turnIndex: number;
  speaker: "interviewer" | "candidate";
  content: string;
};

export type QuestionMappingResult = {
  /** IDs of the interviewer turns chosen as "real questions", ordered by turnIndex. */
  questionTurnIds: string[];
  /** For every turn ID, the questionIndex it belongs to (0-based). */
  turnIdToQuestionIndex: Record<string, number>;
};

const MIN_QUESTION_CHARS = 60;

export function mapTurnsToQuestions(
  turns: ReadonlyArray<MappableTurn>,
  expectedCount: number,
): QuestionMappingResult {
  if (turns.length === 0 || expectedCount <= 0) {
    return { questionTurnIds: [], turnIdToQuestionIndex: {} };
  }

  const sorted = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const interviewer = sorted.filter((t) => t.speaker === "interviewer");

  const longEnough = interviewer.filter((t) => t.content.trim().length >= MIN_QUESTION_CHARS);
  let chosen: MappableTurn[];
  if (longEnough.length >= expectedCount) {
    chosen = longEnough.slice(0, expectedCount);
  } else {
    // Fallback: top-N by length, then resort by turnIndex so the walk below stays monotonic.
    const byLength = [...interviewer].sort(
      (a, b) => b.content.trim().length - a.content.trim().length,
    );
    chosen = byLength.slice(0, expectedCount).sort((a, b) => a.turnIndex - b.turnIndex);
  }

  const chosenIds = new Set(chosen.map((t) => t.id));

  let currentQ = 0;
  const turnIdToQuestionIndex: Record<string, number> = {};
  for (const turn of sorted) {
    // We only bump the counter when we encounter a chosen turn AFTER the first
    // one — the very first chosen turn is question 0.
    if (chosenIds.has(turn.id)) {
      // If this is the first-chosen, currentQ starts at 0; subsequent ones bump.
      const seenAlready = chosen.findIndex((t) => t.id === turn.id);
      currentQ = seenAlready;
    }
    turnIdToQuestionIndex[turn.id] = currentQ;
  }

  return {
    questionTurnIds: chosen.map((t) => t.id),
    turnIdToQuestionIndex,
  };
}
