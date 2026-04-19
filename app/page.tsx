import Link from "next/link";
import {
  ArrowRight,
  FileText,
  LogIn,
  Mic,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LandingPage() {
  const session = await auth();
  const isAuthed = Boolean(session?.user);

  return (
    <div className="relative min-h-screen overflow-hidden bg-hero-radial">
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">PrepMate AI</span>
        </Link>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          {isAuthed ? (
            <Button asChild size="sm">
              <Link href="/dashboard">
                Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">
                  <LogIn className="h-4 w-4" />
                  Sign in
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pb-20 pt-16 text-center sm:pt-24">
          <Badge variant="success" className="mb-5">
            <Sparkles className="h-3 w-3" />
            Meet Maya — your AI interview coach
          </Badge>
          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Practice interviews that <span className="text-gradient-primary">feel like the real thing.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
            Paste any job description. Maya runs a back-and-forth interview — by text or voice — then gives
            you a transcript, honest scores, and a short coaching summary you can act on.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="xl">
              <Link href={isAuthed ? "/interview/new" : "/signup"}>
                {isAuthed ? "Start a new interview" : "Start free"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {!isAuthed ? (
              <Button asChild variant="outline" size="xl">
                <Link href="/login">I already have an account</Link>
              </Button>
            ) : null}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            No credit card. Free while we&apos;re in beta. Works best in Chrome, Edge, or Safari.
          </p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-3">
          <Feature
            icon={<FileText className="h-4 w-4" />}
            title="JD-aware questions"
            body="Paste the JD once. Every question is tailored to the role, seniority, and stack — no generic warm-ups."
          />
          <Feature
            icon={<Mic className="h-4 w-4" />}
            title="Voice mode"
            body="Maya speaks. You answer with your mic. Push-to-talk. No awkward silence detection."
          />
          <Feature
            icon={<Trophy className="h-4 w-4" />}
            title="Honest scoring"
            body="Per-answer breakdown across content, communication, and confidence — plus a final summary."
          />
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <Card>
            <CardContent className="grid gap-6 p-8 lg:grid-cols-3 lg:gap-10 lg:p-10">
              <Step
                index={1}
                icon={<FileText className="h-4 w-4" />}
                title="Set up in 30 seconds"
                body="Name the session, paste the JD, pick 1–10 questions, text or voice."
              />
              <Step
                index={2}
                icon={<MessageSquare className="h-4 w-4" />}
                title="Have a real conversation"
                body="Maya asks a question, you answer, she reacts and moves on — just like a real screen."
              />
              <Step
                index={3}
                icon={<TrendingUp className="h-4 w-4" />}
                title="Review and improve"
                body="See the transcript, each answer's scores, and Maya's coaching notes on your dashboard."
              />
            </CardContent>
          </Card>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <Card className="bg-accent text-accent-foreground">
            <CardContent className="grid items-center gap-4 p-8 sm:grid-cols-[1fr_auto]">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Ready for your next round?</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-accent-foreground/80">
                  Run a quick 5-question warm-up or a full 10-question screen. You decide the reps.
                </p>
              </div>
              <Button asChild size="lg">
                <Link href={isAuthed ? "/interview/new" : "/signup"}>
                  {isAuthed ? "Start a new interview" : "Create your account"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border/60 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} PrepMate AI. Practice interviews that feel real.</p>
          <p>Built for candidates, not recruiters.</p>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </div>
      <p className="mt-4 text-base font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function Step({
  index,
  icon,
  title,
  body,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          {icon}
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {index}
        </span>
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
