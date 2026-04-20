import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

import { InterviewRoom } from "./InterviewRoom";
import { VoiceRoom } from "./VoiceRoom";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interview in progress",
};

export default async function LiveInterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/interview/${id}`);

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      resume: true,
      jobDescription: true,
      transcriptTurns: { orderBy: { turnIndex: "asc" } },
    },
  });

  if (!session || session.userId !== user.id) {
    notFound();
  }

  if (session.status === "completed" || session.status === "completed_partial") {
    redirect(`/dashboard/interview/${session.id}`);
  }

  // Voice sessions route through /prepare before the call room. If someone
  // lands here directly while prep hasn't finished (or failed), bounce them.
  if (session.mode === "voice" && (session.status === "pending" || session.status === "failed")) {
    redirect(`/interview/${session.id}/prepare`);
  }

  const candidateTurns = session.transcriptTurns.filter((t) => t.speaker === "candidate");
  const answeredCount = candidateTurns.length;
  const title = session.jobDescription?.label ?? session.resume?.label ?? "Untitled interview";

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/50 px-6 py-4 backdrop-blur sm:px-10">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            Interview with Maya · {session.mode === "voice" ? "Voice call" : "Text"} mode
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {session.mode === "text" ? (
          <Badge variant="muted">
            Question {answeredCount + 1} of {session.questionCount}
          </Badge>
        ) : (
          <Badge variant="muted">{session.questionCount} question target</Badge>
        )}
        <ThemeToggle />
      </div>
    </header>
  );

  if (session.mode === "voice") {
    return (
      <div className="min-h-screen bg-hero-radial">
        {header}
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          <VoiceRoom sessionId={session.id} />
        </main>
      </div>
    );
  }

  // Text mode is temporarily offline post-schema-v2 (see app/actions/interview.ts).
  // Render a placeholder until the text flow is rebuilt.
  return (
    <div className="min-h-screen bg-hero-radial">
      {header}
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <InterviewRoom
          sessionId={session.id}
          mode={session.mode}
          plannedQuestions={session.questionCount}
          answeredCount={answeredCount}
          currentQuestion={
            "Text mode is temporarily offline after the schema v2 migration. Please switch to voice mode from /interview/new."
          }
          currentOrder={answeredCount}
        />
      </main>
    </div>
  );
}
