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
    include: { results: { orderBy: { order: "asc" } } },
  });

  if (!session || session.userId !== user.id) {
    notFound();
  }

  if (session.status === "COMPLETED") {
    redirect(`/dashboard/interview/${session.id}`);
  }

  const answeredCount = session.results.filter((r) => r.answer !== "").length;
  const pending = session.results.find((r) => r.answer === "");

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
          <p className="truncate text-sm font-semibold text-foreground">{session.title}</p>
          <p className="text-xs text-muted-foreground">
            Interview with Maya · {session.mode === "VOICE" ? "Voice call" : "Text"} mode
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {session.mode === "TEXT" ? (
          <Badge variant="muted">
            Question {answeredCount + 1} of {session.plannedQuestions}
          </Badge>
        ) : (
          <Badge variant="muted">{session.plannedQuestions} question target</Badge>
        )}
        <ThemeToggle />
      </div>
    </header>
  );

  if (session.mode === "VOICE") {
    return (
      <div className="min-h-screen bg-hero-radial">
        {header}
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          <VoiceRoom
            sessionId={session.id}
            title={session.title}
            candidateName={user.name?.split(" ")[0] ?? "there"}
            plannedQuestions={session.plannedQuestions}
            jd={session.resumeText}
            resume={session.resume ?? ""}
          />
        </main>
      </div>
    );
  }

  if (!pending) {
    redirect(`/dashboard/interview/${session.id}`);
  }

  return (
    <div className="min-h-screen bg-hero-radial">
      {header}
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <InterviewRoom
          sessionId={session.id}
          mode={session.mode}
          plannedQuestions={session.plannedQuestions}
          answeredCount={answeredCount}
          currentQuestion={pending.question}
          currentOrder={pending.order}
        />
      </main>
    </div>
  );
}
