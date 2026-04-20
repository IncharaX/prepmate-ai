"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { submitAnswerAction } from "@/app/actions/interview";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  sessionId: string;
  mode: "text" | "voice";
  plannedQuestions: number;
  answeredCount: number;
  currentQuestion: string;
  currentOrder: number;
};

export function InterviewRoom({
  sessionId,
  plannedQuestions,
  answeredCount: initialAnswered,
  currentQuestion: initialQuestion,
}: Props) {
  const router = useRouter();
  const [question, setQuestion] = React.useState(initialQuestion);
  const [answeredCount, setAnsweredCount] = React.useState(initialAnswered);
  const [answer, setAnswer] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const progress = Math.round((answeredCount / plannedQuestions) * 100);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return;

    const trimmed = answer.trim();
    if (!trimmed) {
      setError("Write your answer first.");
      return;
    }

    setError(null);
    setSubmitting(true);

    const result = await submitAnswerAction({ sessionId, answer: trimmed });

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    if (result.completed) {
      toast.success("Interview saved. Generating your summary…");
      router.push(result.redirectTo);
      return;
    }

    setQuestion(result.question);
    setAnsweredCount((c) => c + 1);
    setAnswer("");
    setSubmitting(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Progress: {answeredCount} / {plannedQuestions}
          </span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      <QuestionCard question={question} index={answeredCount + 1} total={plannedQuestions} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={7}
              placeholder="Take your time. Answer like you're speaking to a real interviewer."
              className="min-h-40"
              disabled={submitting}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {answer.trim().length} characters · Cmd+Enter to submit
              </p>
              <Button type="submit" disabled={submitting || !answer.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? "Maya is listening…" : "Submit answer"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
