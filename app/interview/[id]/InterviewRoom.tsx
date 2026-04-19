"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, Volume2, VolumeX } from "lucide-react";

import { submitAnswerAction } from "@/app/actions/interview";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useSTT, useTTS } from "@/lib/voice";

import { MicButton } from "./MicButton";

type Mode = "TEXT" | "VOICE";

type Props = {
  sessionId: string;
  mode: Mode;
  plannedQuestions: number;
  answeredCount: number;
  currentQuestion: string;
  currentOrder: number;
};

export function InterviewRoom({
  sessionId,
  mode: initialMode,
  plannedQuestions,
  answeredCount: initialAnswered,
  currentQuestion: initialQuestion,
  currentOrder: initialOrder,
}: Props) {
  const router = useRouter();

  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [question, setQuestion] = React.useState(initialQuestion);
  const [answeredCount, setAnsweredCount] = React.useState(initialAnswered);
  const [currentOrder, setCurrentOrder] = React.useState(initialOrder);
  const [answer, setAnswer] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = React.useState(true);

  const tts = useTTS();
  const stt = useSTT();

  React.useEffect(() => {
    if (mode === "VOICE" && !stt.supported && typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability fallback
      setMode("TEXT");
      toast.info("Voice mode needs Chrome or Edge. Switched to text.");
    }
  }, [mode, stt.supported]);

  const spokenForRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (mode !== "VOICE" || !tts.supported || !ttsEnabled) return;
    if (spokenForRef.current === currentOrder) return;
    spokenForRef.current = currentOrder;
    tts.speak(question);
  }, [mode, question, currentOrder, tts, ttsEnabled]);

  React.useEffect(() => {
    if (mode !== "VOICE") return;
    const combined = stt.interim ? `${stt.transcript} ${stt.interim}`.trim() : stt.transcript;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external STT transcript into form state
    if (combined) setAnswer(combined);
  }, [mode, stt.transcript, stt.interim]);

  const progress = Math.round((answeredCount / plannedQuestions) * 100);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return;

    const trimmed = answer.trim();
    if (!trimmed) {
      setError("Write or speak your answer first.");
      return;
    }

    setError(null);
    setSubmitting(true);
    tts.cancel();
    if (stt.listening) stt.stop();

    const result = await submitAnswerAction({ sessionId, answer: trimmed });

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    if (result.completed) {
      toast.success("Interview saved. Generating your summary...");
      router.push(result.redirectTo);
      return;
    }

    setQuestion(result.question);
    setCurrentOrder(result.orderIndex);
    setAnsweredCount((c) => c + 1);
    setAnswer("");
    stt.reset();
    spokenForRef.current = null;
    setSubmitting(false);
  }

  function handleMicToggle() {
    if (stt.listening) {
      stt.stop();
    } else {
      tts.cancel();
      stt.start();
    }
  }

  function handleReplay() {
    if (!tts.supported) return;
    tts.speak(question);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    tts.cancel();
    if (stt.listening) stt.stop();
    setMode(next);
    if (next === "VOICE") {
      spokenForRef.current = null;
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

      <QuestionCard
        question={question}
        index={answeredCount + 1}
        total={plannedQuestions}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => switchMode("TEXT")}
            className={`rounded-sm px-3 py-1 text-sm font-medium transition-colors ${
              mode === "TEXT" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => switchMode("VOICE")}
            disabled={!stt.supported}
            className={`rounded-sm px-3 py-1 text-sm font-medium transition-colors ${
              mode === "VOICE" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Voice
          </button>
        </div>

        {mode === "VOICE" && tts.supported ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setTtsEnabled((v) => !v)}>
              {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {ttsEnabled ? "Maya's voice on" : "Maya's voice off"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleReplay}>
              Replay question
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {stt.error && mode === "VOICE" ? (
        <Alert variant="destructive">
          <AlertDescription>Mic error: {stt.error}. Try again or switch to text.</AlertDescription>
        </Alert>
      ) : null}

      {mode === "TEXT" ? (
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="grid gap-4">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={7}
                placeholder="Take your time. Answer like you're speaking to a real interviewer."
                className="min-h-40"
                disabled={submitting}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {answer.trim().length} characters · Cmd+Enter to submit
                </p>
                <Button type="submit" disabled={submitting || !answer.trim()}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Maya is listening..." : "Submit answer"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-6 p-6">
            <div className="flex flex-col items-center gap-3">
              <MicButton listening={stt.listening} disabled={submitting} onToggle={handleMicToggle} />
              <p className="text-sm text-muted-foreground">
                {stt.listening ? "Listening… tap to stop" : "Tap to speak"}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Transcript
              </p>
              <p className="mt-2 min-h-16 text-sm leading-6 text-foreground">
                {answer || (
                  <span className="text-muted-foreground">
                    Your spoken answer will appear here. You can also edit it before submitting.
                  </span>
                )}
                {stt.listening && stt.interim ? (
                  <span className="text-muted-foreground"> {stt.interim}</span>
                ) : null}
              </p>
              {answer ? (
                <button
                  type="button"
                  onClick={() => {
                    setAnswer("");
                    stt.reset();
                  }}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear and try again
                </button>
              ) : null}
            </div>

            <Button
              onClick={() => handleSubmit()}
              disabled={submitting || !answer.trim() || stt.listening}
              size="lg"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Maya is listening..." : "Submit answer"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
