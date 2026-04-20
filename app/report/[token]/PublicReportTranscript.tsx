"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type PublicQuestionEval = {
  id: string;
  questionIndex: number;
  questionText: string;
  answerSummary: string;
  score: number;
  whatWorked: string | null;
  whatToImprove: string | null;
  transcriptQuote: string | null;
};

export function PublicReportTranscript({
  questionEvaluations,
}: {
  questionEvaluations: PublicQuestionEval[];
}) {
  const [open, setOpen] = React.useState(false);

  if (questionEvaluations.length === 0) return null;

  return (
    <section className="grid gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="public-transcript-panel"
        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">
            Show transcript &amp; per-question feedback
          </p>
          <p className="text-xs text-muted-foreground">
            {questionEvaluations.length} question{questionEvaluations.length === 1 ? "" : "s"} · hidden by
            default
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div id="public-transcript-panel" className="grid gap-3">
          {questionEvaluations.map((qe) => (
            <Card key={qe.id}>
              <CardContent className="grid gap-4 p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-muted-foreground">
                    {String(qe.questionIndex).padStart(2, "0")}
                  </p>
                  <Badge variant="muted">{qe.score} / 100</Badge>
                </div>
                <div className="grid gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Question
                  </p>
                  <p className="text-base leading-7 text-foreground">{qe.questionText}</p>
                </div>
                <div className="grid gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Answer (summary)
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                    {qe.answerSummary}
                  </p>
                </div>
                {(qe.whatWorked || qe.whatToImprove || qe.transcriptQuote) && (
                  <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4">
                    {qe.whatWorked ? (
                      <div className="grid gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                          What worked
                        </p>
                        <p className="text-sm leading-6 text-foreground">{qe.whatWorked}</p>
                      </div>
                    ) : null}
                    {qe.whatToImprove ? (
                      <div className="grid gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          What to sharpen
                        </p>
                        <p className="text-sm leading-6 text-foreground">{qe.whatToImprove}</p>
                      </div>
                    ) : null}
                    {qe.transcriptQuote ? (
                      <blockquote className="border-l-2 border-primary/60 pl-3 text-sm italic text-muted-foreground">
                        “{qe.transcriptQuote}”
                      </blockquote>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
}
