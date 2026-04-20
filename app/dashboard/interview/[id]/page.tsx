import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock } from "lucide-react";

import { getAudioSignedUrl, getCurrentShareLink } from "@/app/actions/share";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RUBRIC_V1, type RubricDimension } from "@/lib/rubric";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { FitStatusBadge, type FitStatusValue } from "@/components/report/FitStatusBadge";
import {
  RecommendationBadge,
  type RecommendationValue,
} from "@/components/report/RecommendationBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { EvaluationPoller } from "./EvaluationPoller";
import { ShareCard } from "./ShareCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interview details",
};

type StrengthOrGap = {
  title: string;
  detail: string;
  transcriptQuote: string | null;
  turnId: string | null;
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

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
        turnId: typeof r.turnId === "string" ? r.turnId : null,
      },
    ];
  });
}

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/interview/${id}`);

  const session = await prisma.interviewSession.findFirst({
    where: { id, userId: user.id },
    include: {
      resume: true,
      jobDescription: true,
      transcriptTurns: { orderBy: { turnIndex: "asc" } },
      reportCards: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          questionEvaluations: { orderBy: { questionIndex: "asc" } },
          jdFitItems: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!session) notFound();

  const title = session.jobDescription.label ?? session.resume.label ?? "Untitled interview";
  const candidateTurns = session.transcriptTurns.filter((t) => t.speaker === "candidate");
  const card = session.reportCards[0] ?? null;

  const completed = session.status === "completed" || session.status === "completed_partial";
  const showPoller =
    (completed || session.status === "failed") && !card && candidateTurns.length > 0;
  const pollerError =
    session.status === "completed_partial" || session.status === "failed"
      ? session.errorMessage ?? null
      : null;

  // Phase 7: share link + audio URL (owner view only; audio is nullable).
  const [shareLink, audioUrl] = await Promise.all([
    card ? getCurrentShareLink(card.id) : Promise.resolve(null),
    session.fullAudioUrl ? getAudioSignedUrl(session.id) : Promise.resolve(null),
  ]);

  return (
    <DashboardShell user={user} active="dashboard">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground">
          Dashboard
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{title}</span>
      </div>

      {/* Header */}
      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={session.status} hasError={!!session.errorMessage} />
              <Badge variant="outline">{session.mode === "voice" ? "Voice" : "Text"}</Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(session.createdAt)}
              </span>
            </div>
            <h1 className="mt-3 font-display text-4xl tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {candidateTurns.length} answered · {session.questionCount} planned
              {formatDuration(session.callDurationSeconds)
                ? ` · ${formatDuration(session.callDurationSeconds)}`
                : ""}
            </p>
          </div>
          <Button asChild>
            <Link href="/interview/new">
              Start another
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      {showPoller && <EvaluationPoller sessionId={session.id} initialError={pollerError} />}

      {card ? (
        <>
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
                  <RubricBar
                    key={dim.key}
                    label={dim.label}
                    blurb={dim.blurb}
                    value={scoreFor(card, dim.key)}
                  />
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
            <StrengthGapList
              label="What worked"
              items={parseStrengthsOrGaps(card.strengths)}
              tone="positive"
            />
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
                  <p className="text-xs text-muted-foreground">
                    {card.jdFitItems.filter((i) => i.status === "met").length} met ·{" "}
                    {card.jdFitItems.filter((i) => i.status === "partial").length} partial ·{" "}
                    {card.jdFitItems.filter((i) => i.status === "unclear" || i.status === "not_shown").length}{" "}
                    not shown
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

          {/* Share link — owner-only */}
          <ShareCard reportCardId={card.id} initialLink={shareLink} />

          {/* Per-question transcript */}
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground">Transcript &amp; per-question feedback</h2>
            </div>
            {audioUrl ? (
              <Card>
                <CardContent className="grid gap-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Full call audio{formatDuration(session.callDurationSeconds)
                      ? ` · ${formatDuration(session.callDurationSeconds)}`
                      : ""}
                  </p>
                  {/* preload="none" so we don't burn R2 egress until the user actually plays. */}
                  <audio controls preload="none" src={audioUrl} className="w-full" />
                </CardContent>
              </Card>
            ) : null}
            {card.questionEvaluations.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Per-question scoring wasn&apos;t completed for this session.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {card.questionEvaluations.map((qe) => (
                  <Card key={qe.id}>
                    <CardContent className="grid gap-4 p-6">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs text-muted-foreground">
                          {String(qe.questionIndex).padStart(2, "0")}
                        </p>
                        <Badge variant="muted">{qe.score} / 100</Badge>
                      </div>
                      <div className="grid gap-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Maya asked
                        </p>
                        <p className="text-base leading-7 text-foreground">{qe.questionText}</p>
                      </div>
                      <div className="grid gap-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          You said (summary)
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                          {qe.answerSummary}
                        </p>
                      </div>
                      <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4">
                        {qe.whatWorked ? (
                          <div className="grid gap-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                              What worked
                            </p>
                            <p className="text-sm leading-6 text-foreground">{qe.whatWorked}</p>
                          </div>
                        ) : null}
                        {qe.whatToImprove ? (
                          <div className="grid gap-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              What to sharpen
                            </p>
                            <p className="text-sm leading-6 text-foreground">{qe.whatToImprove}</p>
                          </div>
                        ) : null}
                        {qe.transcriptQuote ? (
                          <blockquote className="border-l-2 border-primary/60 pl-3 text-sm italic text-muted-foreground">
                            “{qe.transcriptQuote}”
                          </blockquote>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      ) : showPoller ? (
        <ReportSkeleton />
      ) : null}
    </DashboardShell>
  );
}

// ============================================================
// Sub-components
// ============================================================

type SessionStatusValue =
  | "pending"
  | "ready"
  | "in_progress"
  | "completed"
  | "completed_partial"
  | "failed"
  | "abandoned";

function StatusBadge({ status, hasError }: { status: SessionStatusValue; hasError: boolean }) {
  if (status === "completed" && !hasError)
    return (
      <Badge variant="success">
        <Check className="h-3 w-3" />
        Completed
      </Badge>
    );
  if (status === "completed_partial") return <Badge variant="muted">Completed (partial)</Badge>;
  if (status === "in_progress") return <Badge variant="muted">In progress</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "ready") return <Badge variant="muted">Ready</Badge>;
  if (status === "pending") return <Badge variant="outline">Preparing</Badge>;
  return <Badge variant="outline">Abandoned</Badge>;
}

function RubricBar({
  label,
  blurb,
  value,
}: {
  label: string;
  blurb: string;
  value: number;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </div>
        <p className="font-mono text-sm tabular-nums text-foreground">{value} / 100</p>
      </div>
      <Progress value={value} />
    </div>
  );
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
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            tone === "positive" ? "text-primary" : "text-muted-foreground",
          )}
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

function ReportSkeleton() {
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 p-6 lg:grid-cols-[auto_1fr] lg:items-center">
          <Skeleton className="h-28 w-28 rounded-lg" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-6">
          <Skeleton className="h-3 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid gap-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-2 p-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    </div>
  );
}
