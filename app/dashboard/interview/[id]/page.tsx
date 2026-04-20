import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock, MessageSquare, Sparkles, TrendingUp, Trophy } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { AutoFinalizer } from "./AutoFinalizer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interview details",
};

type SummaryShape = {
  summary: string;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  partial: boolean;
  successCount?: number;
  totalTurns?: number;
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

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10;
}

function toSummary(value: unknown): SummaryShape | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string") return null;
  return {
    summary: v.summary,
    overallScore: typeof v.overallScore === "number" ? v.overallScore : 0,
    strengths: Array.isArray(v.strengths) ? v.strengths.filter((x): x is string => typeof x === "string") : [],
    improvements: Array.isArray(v.improvements)
      ? v.improvements.filter((x): x is string => typeof x === "string")
      : [],
    partial: v.partial === true,
    successCount: typeof v.successCount === "number" ? v.successCount : undefined,
    totalTurns: typeof v.totalTurns === "number" ? v.totalTurns : undefined,
  };
}

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/interview/${id}`);

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: { results: { orderBy: { order: "asc" } } },
  });

  if (!session || session.userId !== user.id) {
    notFound();
  }

  const answered = session.results.filter((r) => r.answer !== "");
  const summary = toSummary(session.summary);
  const content = average(answered.map((r) => r.contentScore));
  const communication = average(answered.map((r) => r.communicationScore));
  const confidence = average(answered.map((r) => r.confidenceScore));

  const needsScoring =
    session.status === "COMPLETED" && !summary && answered.length > 0;

  return (
    <DashboardShell user={user} active="dashboard">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground">
          Dashboard
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{session.title}</span>
      </div>

      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {session.status === "COMPLETED" ? (
                <Badge variant="success">
                  <Check className="h-3 w-3" />
                  Completed
                </Badge>
              ) : session.status === "IN_PROGRESS" ? (
                <Badge variant="muted">In progress</Badge>
              ) : (
                <Badge variant="outline">Abandoned</Badge>
              )}
              <Badge variant="outline">{session.mode === "VOICE" ? "Voice" : "Text"}</Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(session.createdAt)}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">{session.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {answered.length} answered question{answered.length === 1 ? "" : "s"} · {session.plannedQuestions} planned
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

      {needsScoring ? <AutoFinalizer sessionId={session.id} /> : null}

      {summary ? (
        <Card>
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="grid gap-4">
              <Badge variant="success">
                <Sparkles className="h-3 w-3" />
                Maya&apos;s summary
              </Badge>
              <p className="text-base leading-7 text-foreground">{summary.summary}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <SummaryList
                  label="What worked"
                  items={summary.strengths}
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  emptyText="Maya didn't highlight standout strengths this session."
                />
                <SummaryList
                  label="What to work on"
                  items={summary.improvements}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  emptyText="Nothing pressing flagged."
                />
              </div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 px-8 py-6 text-center">
              <Trophy className="h-5 w-5 text-primary" />
              <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Overall</p>
              <p className="text-5xl font-bold text-gradient-primary">{summary.overallScore}</p>
              <p className="text-xs text-muted-foreground">/ 10</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {answered.length && !needsScoring ? (
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <ScoreTile label="Content" value={content} />
            <ScoreTile label="Communication" value={communication} />
            <ScoreTile label="Confidence" value={confidence} />
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold text-foreground">Transcript</h2>
        {answered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No answers were recorded for this session.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {answered.map((result, index) => (
              <Card key={result.id}>
                <CardContent className="grid gap-4 p-6">
                  <div className="flex items-center gap-2">
                    <Badge variant="muted">Question {index + 1}</Badge>
                  </div>
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Maya asked
                    </p>
                    <p className="text-base leading-7 text-foreground">{result.question}</p>
                  </div>
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Your answer
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{result.answer}</p>
                  </div>
                  {result.feedback ? (
                    <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Feedback
                        </p>
                      </div>
                      <p className="text-sm leading-6 text-foreground">{result.feedback}</p>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <MiniScore label="Content" value={result.contentScore} />
                        <MiniScore label="Communication" value={result.communicationScore} />
                        <MiniScore label="Confidence" value={result.confidenceScore} />
                      </div>
                    </div>
                  ) : needsScoring ? (
                    <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Feedback
                        </p>
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

function SummaryList({
  label,
  items,
  icon,
  emptyText,
}: {
  label: string;
  items: string[];
  icon: React.ReactNode;
  emptyText: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      {items.length ? (
        <ul className="grid gap-1.5 text-sm leading-6 text-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">
        {value}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/10</span>
      </p>
    </div>
  );
}

function MiniScore({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-bold text-foreground">
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/10</span>
      </p>
    </div>
  );
}
