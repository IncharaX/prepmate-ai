"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { scoreVoiceSessionAction } from "@/app/actions/interview";
import { Card, CardContent } from "@/components/ui/card";

export function AutoFinalizer({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const triggeredRef = React.useRef(false);
  const [state, setState] = React.useState<"working" | "error">("working");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;

    let cancelled = false;
    (async () => {
      const result = await scoreVoiceSessionAction(sessionId);
      if (cancelled) return;
      if (result.ok) {
        router.refresh();
      } else {
        setState("error");
        setErrorMessage(result.message);
        toast.error(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardContent className="flex items-center gap-4 p-5">
        {state === "working" ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : (
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
        )}
        <div className="min-w-0">
          {state === "working" ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                Scoring your answers — this takes ~30 seconds
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Maya is grading each answer and writing your summary. The page will refresh automatically when it&apos;s ready.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">Couldn&apos;t finish scoring</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {errorMessage ?? "Something went wrong."} Refresh to try again.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
