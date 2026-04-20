import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { RUBRIC_V1, type RubricDimension } from "@/lib/rubric";
import { FitStatusBadge, type FitStatusValue } from "@/components/report/FitStatusBadge";
import {
  RecommendationBadge,
  type RecommendationValue,
} from "@/components/report/RecommendationBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import { PublicReportTranscript, type PublicQuestionEval } from "./PublicReportTranscript";

// Robots: explicitly keep the report out of search indexes. Knowing the URL
// is the access model; search crawlers finding it undermines that.
export const metadata: Metadata = {
  title: "Interview report",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type StrengthOrGap = {
  title: string;
  detail: string;
  transcriptQuote: string | null;
};

function parseStrengthsOrGaps(value: unknown): StrengthOrGap[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.title !== "string" || typeof r.detail !== "string") return [];
    return [
      {
        title: r.title,
        detail: r.detail,
        transcriptQuote: typeof r.transcriptQuote === "string" ? r.transcriptQuote : null,
      },
    ];
  });
}

function scoreFor(
  card: {
    scoreCommunication: number;
    scoreJdRelevance: number;
    scoreExperienceDepth: number;
    scoreSpecificity: number;
    scoreConfidence: number;
  },
  key: RubricDimension,
): number {
  switch (key) {
    case "communication":
      return card.scoreCommunication;
    case "jdRelevance":
      return card.scoreJdRelevance;
    case "experienceDepth":
      return card.scoreExperienceDepth;
    case "specificity":
      return card.scoreSpecificity;
    case "confidence":
      return card.scoreConfidence;
  }
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Lookup: token live if revokedAt is null AND (expiresAt null OR > now).
  const link = await prisma.reportShareLink.findFirst({
    where: {
      token,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      reportCard: {
        include: {
          questionEvaluations: { orderBy: { questionIndex: "asc" } },
          jdFitItems: { orderBy: { createdAt: "asc" } },
          session: {
            select: {
              jobDescription: { select: { label: true } },
              resume: { select: { label: true } },
              callDurationSeconds: true,
            },
          },
        },
      },
    },
  });

  if (!link) notFound();

  // Fire-and-forget: bump view count without blocking the render.
  prisma.reportShareLink
    .update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    })
    .catch((err) => {
      console.warn("view-count update failed", err);
    });

  const card = link.reportCard;
  const session = card.session;
  const title = session.jobDescription.label ?? session.resume.label ?? "Interview report";

  const qeForClient: PublicQuestionEval[] = card.questionEvaluations.map((qe) => ({
    id: qe.id,
    questionIndex: qe.questionIndex,
    questionText: qe.questionText,
    answerSummary: qe.answerSummary,
    score: qe.score,
    whatWorked: qe.whatWorked,
    whatToImprove: qe.whatToImprove,
    transcriptQuote: qe.transcriptQuote,
  }));

  return (
    <div className="min-h-screen bg-hero-radial">
      <header className="border-b border-border/60 bg-card/70 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold text-foreground">PrepMate AI</span>
          </div>
          <p className="text-xs text-muted-foreground">Interview report</p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-8 sm:px-6">
        {/* Title (no candidate name) */}
        <section className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Report
          </p>
          <h1 className="font-display text-4xl tracking-tight text-foreground">{title}</h1>
        </section>

        {/* Recommendation strip */}
        <Card>
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 px-10 py-6 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall</p>
              <p className="font-display text-6xl tracking-tight text-primary">{card.overallScore}</p>
              <p className="text-xs text-muted-foreground">/ 100</p>
            </div>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <RecommendationBadge value={card.recommendation as RecommendationValue} />
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  <span>Rubric {card.rubricVersion}</span>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" aria-hidden />
                  <span>{card.evaluatorModel}</span>
                </span>
              </div>
              <p className="text-sm leading-6 text-foreground">{card.recommendationReason}</p>
            </div>
          </CardContent>
        </Card>

        {/* Rubric bars */}
        <Card>
          <CardContent className="grid gap-4 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rubric breakdown
            </p>
            <div className="grid gap-3">
              {RUBRIC_V1.map((dim) => (
                <div key={dim.key} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{dim.label}</p>
                      <p className="text-xs text-muted-foreground">{dim.blurb}</p>
                    </div>
                    <p className="font-mono text-sm tabular-nums text-foreground">
                      {scoreFor(card, dim.key)} / 100
                    </p>
                  </div>
                  <Progress value={scoreFor(card, dim.key)} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardContent className="grid gap-4 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Summary
            </p>
            <p className="whitespace-pre-wrap font-display text-lg leading-relaxed text-foreground">
              {card.summary}
            </p>
          </CardContent>
        </Card>

        {/* Strengths + Gaps */}
        <section className="grid gap-4 lg:grid-cols-2">
          <StrengthGapList label="What worked" items={parseStrengthsOrGaps(card.strengths)} tone="positive" />
          <StrengthGapList
            label="What to sharpen"
            items={parseStrengthsOrGaps(card.gaps)}
            tone="neutral"
          />
        </section>

        {/* JD-fit matrix */}
        {card.jdFitItems.length > 0 && (
          <Card>
            <CardContent className="grid gap-4 p-6">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  JD-fit matrix
                </p>
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-1/3 px-4 py-2 font-medium">Requirement</th>
                      <th className="px-4 py-2 font-medium">Must</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.jdFitItems.map((item) => (
                      <tr key={item.id} className="border-t border-border align-top">
                        <td className="px-4 py-3 font-medium text-foreground">{item.requirement}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {item.isMustHave ? "Yes" : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <FitStatusBadge status={item.status as FitStatusValue} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {item.evidence ?? <span className="text-muted-foreground/60">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Collapsible transcript */}
        <PublicReportTranscript questionEvaluations={qeForClient} />
      </main>

      <footer className="border-t border-border/60 px-6 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Powered by PrepMate AI</span>
          <Link href="/" className="hover:text-foreground">
            Try PrepMate AI →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function StrengthGapList({
  label,
  items,
  tone,
}: {
  label: string;
  items: StrengthOrGap[];
  tone: "positive" | "neutral";
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="grid gap-2 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-sm text-muted-foreground">—</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <p
          className={`text-xs font-semibold uppercase tracking-wide ${
            tone === "positive" ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
        <ul className="grid gap-4">
          {items.map((item, i) => (
            <li key={`${i}-${item.title}`} className="grid gap-2">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="text-sm leading-6 text-foreground">{item.detail}</p>
              {item.transcriptQuote ? (
                <blockquote className="border-l-2 border-primary/60 pl-3 text-xs italic text-muted-foreground">
                  “{item.transcriptQuote}”
                </blockquote>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
