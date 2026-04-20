"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { ArrowRight, Briefcase, FileText, Loader2, Mic, MessageSquare, Pencil } from "lucide-react";

import { startInterviewAction, type StartInterviewFormState } from "@/app/actions/interview";
import type { JdRow, ResumeRow } from "@/app/dashboard/library/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import { JdSelectDialog } from "./JdSelectDialog";
import { ResumeSelectDialog } from "./ResumeSelectDialog";

type Mode = "text" | "voice";

export function NewInterviewForm({
  initialResumes,
  initialJobDescriptions,
}: {
  initialResumes: ResumeRow[];
  initialJobDescriptions: JdRow[];
}) {
  const [state, action, pending] = useActionState<StartInterviewFormState, FormData>(
    startInterviewAction,
    undefined,
  );

  const [resumes, setResumes] = React.useState<ResumeRow[]>(initialResumes);
  const [jobDescriptions, setJobDescriptions] = React.useState<JdRow[]>(initialJobDescriptions);

  const [resume, setResume] = React.useState<ResumeRow | null>(null);
  const [jd, setJd] = React.useState<JdRow | null>(null);

  const [resumeDialogOpen, setResumeDialogOpen] = React.useState(false);
  const [jdDialogOpen, setJdDialogOpen] = React.useState(false);

  const [numQuestions, setNumQuestions] = useState(7);
  const [mode, setMode] = useState<Mode>("voice");

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
            <Label>Job description</Label>
            <SelectorTile
              icon={<Briefcase className="h-4 w-4" />}
              emptyLabel="Pick a job description"
              emptyHint="Choose one from your library or paste a new one."
              selected={
                jd
                  ? {
                      title: jd.label,
                      subtitle: [jd.roleTitle, jd.companyName].filter(Boolean).join(" · ") || null,
                    }
                  : null
              }
              onClick={() => setJdDialogOpen(true)}
            />
            <input type="hidden" name="jobDescriptionId" value={jd?.id ?? ""} />
            {state?.fieldErrors?.jobDescriptionId ? (
              <p className="text-xs text-destructive">{state.fieldErrors.jobDescriptionId[0]}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Resume</Label>
            <SelectorTile
              icon={<FileText className="h-4 w-4" />}
              emptyLabel="Pick a resume"
              emptyHint="Choose one from your library or upload a PDF."
              selected={
                resume
                  ? {
                      title: resume.label,
                      subtitle: resume.fileName ?? null,
                    }
                  : null
              }
              onClick={() => setResumeDialogOpen(true)}
            />
            <input type="hidden" name="resumeId" value={resume?.id ?? ""} />
            {state?.fieldErrors?.resumeId ? (
              <p className="text-xs text-destructive">{state.fieldErrors.resumeId[0]}</p>
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
                selected={mode === "text"}
                onClick={() => setMode("text")}
                icon={<MessageSquare className="h-4 w-4" />}
                title="Text"
                subtitle="Type your answers. Works in any browser."
              />
              <ModeOption
                selected={mode === "voice"}
                onClick={() => setMode("voice")}
                icon={<Mic className="h-4 w-4" />}
                title="Voice"
                subtitle="Maya speaks; you answer with your mic. Best in Chrome/Edge."
              />
            </div>
            <input type="hidden" name="mode" value={mode} />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" size="xl" disabled={pending || !resume || !jd}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {pending ? "Preparing Maya..." : "Start interview"}
      </Button>

      <ResumeSelectDialog
        open={resumeDialogOpen}
        onOpenChange={setResumeDialogOpen}
        resumes={resumes}
        selectedId={resume?.id ?? null}
        onSelect={setResume}
        onResumeCreated={(row) => {
          setResumes((rs) => [row, ...rs.filter((r) => r.id !== row.id)]);
          setResume(row);
        }}
      />

      <JdSelectDialog
        open={jdDialogOpen}
        onOpenChange={setJdDialogOpen}
        jobDescriptions={jobDescriptions}
        selectedId={jd?.id ?? null}
        onSelect={setJd}
        onJdCreated={(row) => {
          setJobDescriptions((js) => [row, ...js.filter((j) => j.id !== row.id)]);
          setJd(row);
        }}
      />
    </form>
  );
}

function SelectorTile({
  icon,
  emptyLabel,
  emptyHint,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  emptyLabel: string;
  emptyHint: string;
  selected: { title: string; subtitle: string | null } | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-primary/30 bg-card hover:border-primary/60"
          : "border-dashed border-border hover:border-primary/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        {selected ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{selected.title}</p>
            <p className="truncate text-xs text-muted-foreground">{selected.subtitle ?? "Ready"}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{emptyLabel}</p>
            <p className="truncate text-xs text-muted-foreground">{emptyHint}</p>
          </div>
        )}
      </div>
      <span className="flex items-center gap-1 text-xs font-medium text-primary">
        <Pencil className="h-3 w-3" />
        {selected ? "Change" : "Choose"}
      </span>
    </button>
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
