"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { FeedbackCard } from "@/components/interview/FeedbackCard";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EvaluationResult = {
  question: string;
  score: {
    content: number;
    communication: number;
    confidence: number;
  };
  feedback: string;
  nextQuestion?: string;
  sessionComplete?: boolean;
};

type QuestionResult = {
  question: string;
  sessionId?: string;
};

export default function InterviewPage() {
  const [jdText, setJdText] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function postInterview(payload: Record<string, string>) {
    const response = await fetch("/api/interview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Something went wrong. Please try again.");
    }

    return data;
  }

  async function handleStartInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setQuestion("");
    setAnswer("");
    setIsComplete(false);

    setSessionId("");

    if (!jdText.trim()) {
      setError("Paste the job description before starting.");
      return;
    }

    setIsStarting(true);

    try {
      const data = (await postInterview({
        jdText,
      })) as QuestionResult;

      setQuestion(data.question);
      setSessionId(data.sessionId ?? "");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the interview.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleSubmitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!answer.trim()) {
      setError("Write an answer before submitting.");
      return;
    }

    setIsSubmitting(true);

    try {
      const data = (await postInterview({
        jdText,
        question,
        answer,
        ...(sessionId ? { sessionId } : {}),
      })) as EvaluationResult;

      setResult(data);
      setAnswer("");
      setQuestion(data.nextQuestion ?? "");
      setIsComplete(Boolean(data.sessionComplete));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not evaluate the answer.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7fbfa] px-4 py-10 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="rounded-lg border border-emerald-100 bg-white p-6 shadow-[0_20px_60px_rgba(16,185,129,0.12)]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge className="gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                PrepMate AI
              </Badge>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">AI Interview Coach</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">
                Paste the JD and practice with an HR interviewer that follows the role, the tone, and your answers.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard">View Dashboard</Link>
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Start a focused HR screen</CardTitle>
            <CardDescription>The JD already contains the role, skills, seniority, and expectations. That is all Maya needs.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStartInterview} className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="jd">Paste JD</Label>
                <Textarea
                  id="jd"
                  value={jdText}
                  onChange={(event) => setJdText(event.target.value)}
                  rows={8}
                  placeholder="Paste the job description, role expectations, tech stack, and responsibilities here."
                  className="min-h-48"
                />
              </div>

              <Button type="submit" disabled={isStarting || isSubmitting} className="w-full">
                {isStarting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating question...
                  </>
                ) : (
                  <>
                    Start Interview
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {error ? <Alert>{error}</Alert> : null}

        {question ? (
          <div className="grid gap-6">
            {question ? <QuestionCard question={question} /> : null}

            {question ? (
              <Card>
              <CardHeader>
                <CardTitle>Your answer</CardTitle>
                <CardDescription>Maya is listening for clarity, judgment, ownership, and role fit.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitAnswer} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="answer">Response</Label>
                    <Textarea
                      id="answer"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      rows={7}
                      placeholder="Answer as if you are speaking to an interviewer."
                      className="min-h-40"
                    />
                  </div>

                  <Button type="submit" disabled={isStarting || isSubmitting} variant="dark" className="w-full">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Evaluating answer...
                      </>
                    ) : (
                      "Submit Answer"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
            ) : null}
          </div>
        ) : null}

        {isComplete ? (
          <Card className="border-emerald-100 shadow-[0_18px_45px_rgba(16,185,129,0.10)]">
            <CardContent className="p-5">
              <Badge className="border-cyan-200 bg-cyan-50 text-cyan-800">Interview complete</Badge>
              <p className="mt-4 text-lg font-semibold text-zinc-950">Nice work. Your HR screen has been saved.</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Review your trends and readiness score on the dashboard whenever you want a calmer look at the numbers.
              </p>
              <Button asChild className="mt-5">
                <Link href="/dashboard">Open Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {result ? <FeedbackCard score={result.score} feedback={result.feedback} /> : null}
      </div>
    </main>
  );
}
