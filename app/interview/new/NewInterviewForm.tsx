"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2, Mic, MessageSquare } from "lucide-react";

import { startInterviewAction, type StartInterviewFormState } from "@/app/actions/interview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "TEXT" | "VOICE";

export function NewInterviewForm() {
  const [state, action, pending] = useActionState<StartInterviewFormState, FormData>(
    startInterviewAction,
    undefined,
  );
  const [numQuestions, setNumQuestions] = useState(7);
  const [mode, setMode] = useState<Mode>("TEXT");

  return (
    <form action={action} className="grid gap-5">
      {state?.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-5 p-6">
          <div className="grid gap-2">
            <Label htmlFor="title">Interview title</Label>
            <Input
              id="title"
              name="title"
              placeholder="e.g. Stripe SWE screen"
              maxLength={80}
              required
            />
            {state?.fieldErrors?.title ? (
              <p className="text-xs text-destructive">{state.fieldErrors.title[0]}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="jdText">Job description</Label>
            <Textarea
              id="jdText"
              name="jdText"
              rows={10}
              placeholder="Paste the full job description — responsibilities, tech stack, seniority, team context."
              className="min-h-48"
              required
            />
            {state?.fieldErrors?.jdText ? (
              <p className="text-xs text-destructive">{state.fieldErrors.jdText[0]}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-6 p-6">
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="numQuestions">Number of questions</Label>
              <span className="rounded-md border border-border bg-muted/50 px-2.5 py-0.5 text-sm font-semibold text-foreground">
                {numQuestions}
              </span>
            </div>
            <Slider
              id="numQuestions"
              min={1}
              max={10}
              step={1}
              value={[numQuestions]}
              onValueChange={([v]) => setNumQuestions(v)}
            />
            <input type="hidden" name="numQuestions" value={numQuestions} />
            <p className="text-xs text-muted-foreground">
              Between 1 and 10. A typical HR screen is 5–8 questions (~15 min).
            </p>
          </div>

          <div className="grid gap-3">
            <Label>Mode</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeOption
                selected={mode === "TEXT"}
                onClick={() => setMode("TEXT")}
                icon={<MessageSquare className="h-4 w-4" />}
                title="Text"
                subtitle="Type your answers. Works in any browser."
              />
              <ModeOption
                selected={mode === "VOICE"}
                onClick={() => setMode("VOICE")}
                icon={<Mic className="h-4 w-4" />}
                title="Voice"
                subtitle="Maya speaks; you answer with your mic. Best in Chrome/Edge."
              />
            </div>
            <input type="hidden" name="mode" value={mode} />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="xl" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {pending ? "Preparing Maya..." : "Start interview"}
      </Button>
    </form>
  );
}

function ModeOption({
  selected,
  onClick,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-accent text-accent-foreground"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}
