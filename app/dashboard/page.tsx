import Link from "next/link";
import { BarChart3, ClipboardList, LayoutDashboard, Sparkles } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { ReadinessCard } from "@/components/dashboard/ReadinessCard";
import { ScoreTrendChart, type ScoreTrendPoint } from "@/components/dashboard/ScoreTrendChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MobileSidebarNav,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarLayout,
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export const dynamic = "force-dynamic";

type SessionSummary = {
  id: string;
  domain: string;
  date: string;
  resultCount: number;
  content: number;
  communication: number;
  confidence: number;
};

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

async function getDashboardData() {
  const user = await prisma.user
    .findFirst({
      where: {
        sessions: {
          some: {
            results: {
              some: {},
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        sessions: {
          where: {
            results: {
              some: {},
            },
          },
          orderBy: {
            createdAt: "asc",
          },
          include: {
            results: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        },
      },
    })
    .catch((error: unknown) => {
      console.error("Failed to load dashboard data", error);
      return null;
    });

  if (!user) {
    return null;
  }

  const sessions: SessionSummary[] = user.sessions.map((session) => {
    const content = roundScore(average(session.results.map((result) => result.contentScore)));
    const communication = roundScore(average(session.results.map((result) => result.communicationScore)));
    const confidence = roundScore(average(session.results.map((result) => result.confidenceScore)));

    return {
      id: session.id,
      domain: session.domain,
      date: formatDate(session.createdAt),
      resultCount: session.results.length,
      content,
      communication,
      confidence,
    };
  });

  const chartData: ScoreTrendPoint[] = sessions.map((session, index) => ({
    label: `${index + 1}. ${session.date}`,
    content: session.content,
    communication: session.communication,
    confidence: session.confidence,
  }));

  const allScores = sessions.flatMap((session) => [session.content, session.communication, session.confidence]);
  const answerCount = user.sessions.reduce((total, session) => total + session.results.length, 0);

  return {
    userName: user.name,
    readinessScore: roundScore(average(allScores)),
    answerCount,
    sessions,
    chartData,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <SidebarLayout>
      <Sidebar>
        <SidebarHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-zinc-950">PrepMate AI</p>
            <p className="text-xs text-zinc-500">Interview Coach</p>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuButton href="/dashboard" data-active="true">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </SidebarMenuButton>
              <SidebarMenuButton href="/interview">
                <ClipboardList className="h-4 w-4" />
                Start Interview
              </SidebarMenuButton>
            </SidebarMenu>
          </SidebarGroup>
          <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-4">
            <p className="text-sm font-semibold text-cyan-950">HR-style practice</p>
            <p className="mt-2 text-sm leading-6 text-cyan-800">
              Maya follows the JD and your answers, then saves the session for trend tracking.
            </p>
          </div>
        </SidebarContent>
      </Sidebar>
      <div className="min-w-0">
        <MobileSidebarNav>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-950">PrepMate AI</p>
                <p className="text-xs text-zinc-500">Dashboard</p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href="/interview">Start</Link>
            </Button>
          </div>
        </MobileSidebarNav>
        <SidebarInset>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-lg border border-emerald-100 bg-white p-6 shadow-[0_20px_60px_rgba(16,185,129,0.12)]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge className="gap-2">
                <BarChart3 className="h-3.5 w-3.5" />
                PrepMate AI
              </Badge>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">Dashboard</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">
                Track interview practice, score movement, and readiness over time.
              </p>
            </div>
            <Button asChild>
              <Link href="/interview">
                Start Interview
                <Sparkles className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>

        {!data ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-xl font-bold text-zinc-950">No interview history yet</p>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-600">
                Complete an interview session and save results to the database to unlock trends and readiness scoring.
              </p>
              <Button asChild className="mt-6">
                <Link href="/interview">Start Interview</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <ReadinessCard
              score={data.readinessScore}
              sessionCount={data.sessions.length}
              answerCount={data.answerCount}
            />

            <ScoreTrendChart data={data.chartData} />

            <Card>
              <CardHeader className="border-b border-zinc-200">
                <Badge className="w-fit border-rose-200 bg-rose-50 text-rose-700">History</Badge>
                <CardTitle>{data.userName}&apos;s sessions</CardTitle>
              </CardHeader>
              <div className="divide-y divide-zinc-200">
                {data.sessions.map((session) => (
                  <article key={session.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <p className="text-lg font-semibold text-zinc-950">{session.domain}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {session.date} · {session.resultCount} evaluated answer{session.resultCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <ScorePill label="Content" value={session.content} />
                      <ScorePill label="Comm." value={session.communication} />
                      <ScorePill label="Confidence" value={session.confidence} />
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
        </SidebarInset>
      </div>
    </SidebarLayout>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-sm font-bold text-zinc-950">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
