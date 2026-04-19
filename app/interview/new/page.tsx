import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

import { NewInterviewForm } from "./NewInterviewForm";

export const metadata: Metadata = {
  title: "New interview",
};

export default async function NewInterviewPage() {
  await requireUser("/interview/new");

  return (
    <div className="min-h-screen bg-hero-radial">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
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
            Paste the JD, name this session, pick how many questions you want, and choose whether you&apos;d
            rather type or talk. Maya will take it from there.
          </p>
        </div>

        <NewInterviewForm />
      </main>
    </div>
  );
}
