import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronRight, Clock, FileText, Sparkles } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReadinessCard } from "@/components/dashboard/ReadinessCard";
import { ScoreTrendChart, type ScoreTrendPoint } from "@/components/dashboard/ScoreTrendChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

type SessionSummary = {
  id: string;
  title: string;
  createdAt: Date;
  mode: "TEXT" | "VOICE";
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  plannedQuestions: number;
  answeredCount: number;
  content: number;
  communication: number;
  confidence: number;
  average: number;
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");

  const sessions = await prisma.interviewSession.findMany({
    where: { userId: user.id },
    include: { results: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  const summaries: SessionSummary[] = sessions.map((s) => {
    const answered = s.results.filter((r) => r.answer !== "");
    const content = roundScore(average(answered.map((r) => r.contentScore)));
    const communication = roundScore(average(answered.map((r) => r.communicationScore)));
    const confidence = roundScore(average(answered.map((r) => r.confidenceScore)));
    const avg = roundScore(average([content, communication, confidence]));
    return {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      mode: s.mode,
      status: s.status,
      plannedQuestions: s.plannedQuestions,
      answeredCount: answered.length,
      content,
      communication,
      confidence,
      average: avg,
    };
  });

  const completed = summaries.filter((s) => s.status === "COMPLETED");
  const chartData: ScoreTrendPoint[] = [...completed]
    .reverse()
    .map((s, index) => ({
      label: `${index + 1}. ${formatDate(s.createdAt).split(",")[0]}`,
      content: s.content,
      communication: s.communication,
      confidence: s.confidence,
    }));

  const answerCount = summaries.reduce((t, s) => t + s.answeredCount, 0);
  const readinessScore = roundScore(
    average(completed.flatMap((s) => [s.content, s.communication, s.confidence])),
  );

  return (
    <DashboardShell user={user} active="dashboard">
      <header className="grid gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge variant="success">
              <Sparkles className="h-3 w-3" />
              {user.name ? `Welcome, ${user.name.split(" ")[0]}` : "Welcome"}
            </Badge>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">Your dashboard</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Track your practice over time, review past interviews, and keep shaping the story you&apos;ll tell
              in the real one.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/interview/new">
              <Sparkles className="h-4 w-4" />
              New interview
            </Link>
          </Button>
        </div>
      </header>

      {summaries.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ReadinessCard
            score={readinessScore}
            sessionCount={completed.length}
            answerCount={answerCount}
          />

          {chartData.length >= 2 ? <ScoreTrendChart data={chartData} /> : null}

          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Your sessions</h2>
              <p className="text-xs text-muted-foreground">{summaries.length} total</p>
            </div>
            <Card>
              <ul className="divide-y divide-border">
                {summaries.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}
    </DashboardShell>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const href =
    session.status === "COMPLETED" ? `/dashboard/interview/${session.id}` : `/interview/${session.id}`;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{session.title}</p>
            <StatusBadge status={session.status} />
            <Badge variant="outline" className="font-normal">
              {session.mode === "VOICE" ? "Voice" : "Text"}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDate(session.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {session.answeredCount} / {session.plannedQuestions} answered
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {session.status === "COMPLETED" ? (
            <div className="hidden text-right sm:block">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg</p>
              <p className="text-xl font-bold text-gradient-primary">{session.average}</p>
            </div>
          ) : null}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: SessionSummary["status"] }) {
  if (status === "COMPLETED") return <Badge variant="success">Completed</Badge>;
  if (status === "IN_PROGRESS") return <Badge variant="muted">In progress</Badge>;
  return <Badge variant="outline">Abandoned</Badge>;
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="grid gap-4 p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="grid gap-2">
          <p className="text-xl font-semibold text-foreground">No interviews yet</p>
          <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
            Start your first session to build your history. Maya will track your readiness over time and
            surface what&apos;s worth working on.
          </p>
        </div>
        <Button asChild size="lg" className="mx-auto">
          <Link href="/interview/new">
            Start your first interview
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
