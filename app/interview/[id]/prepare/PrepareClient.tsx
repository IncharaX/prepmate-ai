"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { prepareInterviewSession, retryPrepAction } from "@/app/actions/prepare";
import type { PrepPreviewItem } from "@/lib/prompts/planner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Status = "pending" | "failed";

export function PrepareClient({
  sessionId,
  initialStatus,
  initialError,
  initialPreview,
}: {
  sessionId: string;
  initialStatus: Status;
  initialError: string | null;
  initialPreview: PrepPreviewItem[] | null;
}) {
  const router = useRouter();
  const [working, setWorking] = React.useState<boolean>(initialStatus === "pending");
  const [error, setError] = React.useState<string | null>(
    initialStatus === "failed" ? initialError ?? "Preparing failed." : null,
  );
  const triggeredRef = React.useRef(false);

  // Fire the planner exactly once on mount when the session is still pending.
  React.useEffect(() => {
    if (initialStatus !== "pending") return;
    if (triggeredRef.current) return;
    triggeredRef.current = true;

    let cancelled = false;
    (async () => {
      const result = await prepareInterviewSession(sessionId);
      if (cancelled) return;
      if (result.ok) {
        // Server action set status=ready + wrote prepData. Refresh the page to
        // pick up the new server-side preview.
        router.refresh();
      } else {
        setWorking(false);
        setError(result.message);
        toast.error(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialStatus, sessionId, router]);

  async function handleRetry() {
    setError(null);
    setWorking(true);
    const result = await retryPrepAction(sessionId);
    if (result.ok) {
      router.refresh();
    } else {
      setWorking(false);
      setError(result.message);
      toast.error(result.message);
    }
  }

  if (initialPreview && !working && !error) {
    return <ReadyState sessionId={sessionId} preview={initialPreview} />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="grid gap-4 p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Couldn&apos;t finish preparing</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">{error}</p>
          </div>
          <Alert variant="default" className="text-left">
            <AlertDescription>
              This usually means the planning service was briefly unavailable. Try again — it&apos;s
              cheap and usually succeeds on retry.
            </AlertDescription>
          </Alert>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
            <Button onClick={handleRetry}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-5 p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <div className="space-y-2">
          <p className="font-display text-2xl tracking-tight text-foreground">Preparing</p>
          <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
            Maya is reading your resume and the job posting — shaping a plan of what to cover.
            Usually 10–20 seconds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadyState({
  sessionId,
  preview,
}: {
  sessionId: string;
  preview: PrepPreviewItem[];
}) {
  return (
    <Card>
      <CardContent className="grid gap-6 p-8">
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-primary">Ready</span>
          <h1 className="font-display text-3xl tracking-tight text-foreground">
            Here&apos;s what Maya will cover with you today.
          </h1>
          <p className="text-sm text-muted-foreground">
            She&apos;ll react to your answers and follow up naturally — this is a rough flow, not a
            script.
          </p>
        </div>

        <ol className="grid gap-2">
          {preview.map((item) => (
            <li
              key={item.index}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
            >
              <span className="mt-0.5 font-mono text-xs text-muted-foreground">
                {String(item.index).padStart(2, "0")}
              </span>
              <span className="text-sm leading-6 text-foreground">{item.title}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-5">
          <Button
            asChild
            size="lg"
            className="sm:min-w-56"
            aria-label="Start the voice call with Maya"
          >
            <a href={`/interview/${sessionId}`}>
              <Sparkles className="h-4 w-4" />
              Start call with Maya
              <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
