/**
 * Rubric v1 — HR-screen evaluation anchors.
 *
 * These anchor descriptions are the calibration standard the evaluator LLM
 * uses to pin each score to a specific behavioral band. Change them and you
 * change what every ReportCard means — bump `RUBRIC_VERSION` when you do, so
 * historical reports stay auditable.
 */
import { z } from "zod";

export const RUBRIC_VERSION = "v1";

export type RubricDimension =
  | "communication"
  | "jdRelevance"
  | "experienceDepth"
  | "specificity"
  | "confidence";

export type RubricAnchor = {
  score: 20 | 40 | 60 | 80 | 100;
  label: string;
  description: string;
};

export type RubricDimensionSpec = {
  key: RubricDimension;
  label: string;
  blurb: string;
  anchors: RubricAnchor[];
};

export const RUBRIC_V1: ReadonlyArray<RubricDimensionSpec> = [
  {
    key: "communication",
    label: "Communication",
    blurb: "Clarity, structure, energy, and conversational fit.",
    anchors: [
      {
        score: 20,
        label: "Unclear",
        description:
          "Rambles, interrupts themselves, can't finish a thought. Listener ends the turn unsure what was said.",
      },
      {
        score: 40,
        label: "Rough",
        description:
          "Points are findable but buried in filler. Structure absent; either way too short ('yeah, I did that') or way too long without landmarks.",
      },
      {
        score: 60,
        label: "Okay",
        description:
          "Thoughts complete, audible enthusiasm, listener rarely confused. Occasional rambling or flat affect.",
      },
      {
        score: 80,
        label: "Strong",
        description:
          "Answers have obvious structure (signposts like 'three things…', clear situation → action → result), pace matches the room, modulates on follow-ups.",
      },
      {
        score: 100,
        label: "Exceptional",
        description:
          "Every answer lands like a mini-TED-talk — concise, narrative, natural. Listener could summarise the answer in one sentence afterward.",
      },
    ],
  },
  {
    key: "jdRelevance",
    label: "JD Relevance",
    blurb: "How well answers connect to what the role actually needs.",
    anchors: [
      {
        score: 20,
        label: "Off-topic",
        description:
          "Answers don't reference the role at all, or pull from unrelated experience without bridging. Generic advice / abstract opinions.",
      },
      {
        score: 40,
        label: "Loose",
        description:
          "Touches the domain but doesn't tie experience back to the specific requirements named in the JD. 'I know React, yeah.'",
      },
      {
        score: 60,
        label: "Relevant",
        description:
          "Explicitly names 1–2 JD requirements and maps experience to them. Reasoning is present but light.",
      },
      {
        score: 80,
        label: "Targeted",
        description:
          "Answers trace directly to specific JD line items — must-haves first, then nice-to-haves. Shows the candidate read the JD carefully.",
      },
      {
        score: 100,
        label: "Bullseye",
        description:
          "Every answer, including warmups, is framed through the lens of this role. Feels like the candidate is already in the job, describing how they'd operate.",
      },
    ],
  },
  {
    key: "experienceDepth",
    label: "Experience Depth",
    blurb: "Substance and seniority behind claims.",
    anchors: [
      {
        score: 20,
        label: "Superficial",
        description:
          "Claims without evidence ('I've led teams'). No concrete systems, numbers, tradeoffs, or constraints mentioned.",
      },
      {
        score: 40,
        label: "Thin",
        description: "Mentions projects but at a surface level — no scale, no decisions, no failures.",
      },
      {
        score: 60,
        label: "Solid",
        description:
          "At least one concrete example with scope (team size, timeline, users) and a real decision they owned.",
      },
      {
        score: 80,
        label: "Deep",
        description:
          "Multiple examples with tradeoffs made, alternatives rejected, concrete metrics (latency, scale, revenue). Pattern recognition across situations.",
      },
      {
        score: 100,
        label: "Principal-level",
        description:
          "Answers reveal a mental model of how systems/people work in the domain. Teaches the interviewer something about the problem space.",
      },
    ],
  },
  {
    key: "specificity",
    label: "Specificity",
    blurb: "Names, numbers, outcomes vs generalities.",
    anchors: [
      {
        score: 20,
        label: "Vague",
        description:
          "Answers live at platitude level ('we solved the problem and shipped it'). Zero numbers, zero named tools or people.",
      },
      {
        score: 40,
        label: "Fuzzy",
        description: "Generalities sprinkled with one or two concrete nouns but no measurable outcomes.",
      },
      {
        score: 60,
        label: "Concrete",
        description:
          "Names the stack, the team, the timeline. Outcomes referenced but loosely ('performance improved').",
      },
      {
        score: 80,
        label: "Quantified",
        description:
          "Names + numbers + timeframes. 'Cut p95 from 800ms → 220ms over 6 weeks by moving the image pipeline to Cloudflare Images.'",
      },
      {
        score: 100,
        label: "Receipts",
        description:
          "Answers sound auditable. Could pull up a PR, a dashboard, or a Google Doc to prove every claim. Nothing generic.",
      },
    ],
  },
  {
    key: "confidence",
    label: "Confidence",
    blurb: "How the candidate owns their answers under pressure.",
    anchors: [
      {
        score: 20,
        label: "Shaky",
        description:
          "Hedges on everything, defers to 'the team' when asked personal questions, apologises preemptively.",
      },
      {
        score: 40,
        label: "Guarded",
        description:
          "Clear answers only when they're safe; flinches on 'what was hard?' or 'what would you do differently?'",
      },
      {
        score: 60,
        label: "Grounded",
        description:
          "Comfortable with their own judgment, admits uncertainty cleanly ('I'd want to check X before deciding').",
      },
      {
        score: 80,
        label: "Composed",
        description:
          "Handles pushback well, reframes surprising questions without losing their footing, distinguishes what they know from what they're guessing.",
      },
      {
        score: 100,
        label: "Presence",
        description:
          "Makes the interviewer feel they'd be a calm hand in a real crisis. Owns mistakes without drama. Disagrees when warranted, without being combative.",
      },
    ],
  },
] as const;

/**
 * Render the rubric as a plain-text block to embed in the evaluator prompt.
 * Stable format — the LLM is trained on the structure, don't reorder lightly.
 */
export function renderRubricForPrompt(): string {
  const lines: string[] = [];
  lines.push(`RUBRIC v${RUBRIC_VERSION}. Score every dimension 0–100. Use these anchors as calibration.`);
  lines.push("");
  for (const dim of RUBRIC_V1) {
    lines.push(`## ${dim.label} (key: ${dim.key})`);
    lines.push(`${dim.blurb}`);
    for (const anchor of dim.anchors) {
      lines.push(`- ${anchor.score} (${anchor.label}): ${anchor.description}`);
    }
    lines.push("");
  }
  lines.push(
    "Interpolate between anchors when a candidate sits between two bands. Never score higher than the evidence in the transcript supports.",
  );
  return lines.join("\n");
}

/** Integer score 0–100, zod helper for validating LLM output. */
export const intScore = z
  .number()
  .int({ message: "score must be an integer" })
  .min(0, { message: "score < 0" })
  .max(100, { message: "score > 100" });
