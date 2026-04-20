"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  evaluateInterviewSession,
  getEvaluationStatusAction,
  retryEvaluationAction,
} from "@/app/actions/evaluate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  sessionId: string;
  initialError?: string | null;
};

const POLL_INTERVAL_MS = 3_000;
const POLL_DEADLINE_MS = 90_000;
/** How long we wait before firing a defensive evaluateInterviewSession call. */
const DEFENSIVE_KICK_AFTER_MS = 5_000;

export function EvaluationPoller({ sessionId, initialError }: Props) {
  const router = useRouter();
  const [state, setState] = React.useState<"working" | "error" | "timeout">(
    initialError ? "error" : "working",
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(initialError ?? null);
  const kickedRef = React.useRef(false);

  React.useEffect(() => {
    if (state !== "working") return;

    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      const result = await getEvaluationStatusAction(sessionId).catch((err) => {
        console.warn("poll failed", err);
        return null;
      });
      if (cancelled) return;

      if (result?.status === "ready") {
        router.refresh();
        return;
      }
      if (result?.status === "error") {
        setState("error");
        setErrorMessage(result.message);
        return;
      }

      // Still pending. If we've waited long enough, kick the action once
      // defensively (after() from the server action may have been dropped).
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DEFENSIVE_KICK_AFTER_MS && !kickedRef.current) {
        kickedRef.current = true;
        evaluateInterviewSession(sessionId).catch((err) => {
          console.warn("defensive kick failed", err);
        });
      }

      if (elapsed >= POLL_DEADLINE_MS) {
        setState("timeout");
        setErrorMessage("Evaluation is taking longer than expected. Try a manual retry.");
        return;
      }

      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, router, state]);

  async function handleRetry() {
    setState("working");
    setErrorMessage(null);
    kickedRef.current = false;
    const result = await retryEvaluationAction(sessionId);
    if (result.ok) {
      router.refresh();
    } else {
      setState("error");
      setErrorMessage(result.message);
      toast.error(result.message);
    }
  }

  if (state === "error" || state === "timeout") {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {state === "timeout" ? "Evaluation is slow" : "Couldn't finish scoring"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {errorMessage ??
                "The evaluator had trouble. Retry — it's cheap and usually succeeds on the second try."}
            </p>
          </div>
          <Button onClick={handleRetry} size="sm">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardContent className="flex items-center gap-4 p-5">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Scoring your answers — usually ~30 seconds
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Maya is reading the transcript, scoring each dimension, and writing cited feedback. This
            page will refresh when it&apos;s ready.
          </p>
        </div>
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <Alert className="hidden" variant="info">
          <AlertDescription />
        </Alert>
      </CardContent>
    </Card>
  );
}
