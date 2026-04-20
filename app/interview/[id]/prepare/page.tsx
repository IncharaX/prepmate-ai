import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPrepPreview, plannerResponseSchema, type PlannerResponse } from "@/lib/prompts/planner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

import { PrepareClient } from "./PrepareClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preparing",
};

export default async function PreparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/interview/${id}/prepare`);

  const session = await prisma.interviewSession.findFirst({
    where: { id, userId: user.id },
    include: {
      resume: { select: { label: true } },
      jobDescription: { select: { label: true } },
    },
  });
  if (!session) notFound();

  if (session.mode !== "voice") {
    // Text mode doesn't use prep.
    redirect(`/interview/${session.id}`);
  }

  // Already past prep → go straight to the call.
  if (session.status === "ready" || session.status === "in_progress") {
    redirect(`/interview/${session.id}`);
  }
  if (
    session.status === "completed" ||
    session.status === "completed_partial" ||
    session.status === "abandoned"
  ) {
    redirect(`/dashboard/interview/${session.id}`);
  }

  const title = session.jobDescription.label ?? session.resume.label ?? "Interview";
  const preview = extractPreview(session.prepData);

  return (
    <div className="min-h-screen bg-hero-radial">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/50 px-6 py-4 backdrop-blur sm:px-10">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="muted">{title}</Badge>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <PrepareClient
          sessionId={session.id}
          initialStatus={session.status as "pending" | "failed"}
          initialError={session.errorMessage ?? null}
          initialPreview={preview}
        />
      </main>
    </div>
  );
}

function extractPreview(prepData: unknown) {
  if (!prepData || typeof prepData !== "object") return null;
  const parsed = plannerResponseSchema.safeParse(prepData);
  if (!parsed.success) return null;
  return buildPrepPreview((parsed.data as PlannerResponse).questionPlan);
}
