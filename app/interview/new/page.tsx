import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

import { NewInterviewForm } from "./NewInterviewForm";

export const metadata: Metadata = {
  title: "New interview",
};

export default async function NewInterviewPage() {
  const user = await requireUser("/interview/new");

  const [resumes, jobDescriptions] = await Promise.all([
    prisma.resume.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        fileName: true,
        fileSizeBytes: true,
        createdAt: true,
      },
    }),
    prisma.jobDescription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        companyName: true,
        roleTitle: true,
        rawText: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="min-h-screen bg-hero-radial">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Cancel</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16 sm:px-6">
        <div className="mt-6 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Set up your session
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Start a new interview</h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            Pick a resume and JD from your library — or add new ones inline. Choose how many
            questions and whether you want to type or talk.
          </p>
        </div>

        <NewInterviewForm
          initialResumes={resumes.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
          initialJobDescriptions={jobDescriptions.map((j) => ({
            ...j,
            createdAt: j.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
