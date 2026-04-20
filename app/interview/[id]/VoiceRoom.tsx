"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Loader2, Mic, PhoneOff, Phone } from "lucide-react";
import { toast } from "sonner";

import { endVoiceCallAction, markInterviewStartedAction } from "@/app/actions/interview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  sessionId: string;
};

type SignedUrlResponse = {
  signedUrl: string;
  dynamicVariables: Record<string, string | number | boolean>;
};

type Phase = "idle" | "starting" | "live" | "finalizing" | "ended";

type TranscriptMessage = {
  role: "user" | "agent";
  text: string;
  at: number;
};

export function VoiceRoom(props: Props) {
  return (
    <ConversationProvider>
      <VoiceRoomInner {...props} />
    </ConversationProvider>
  );
}

function VoiceRoomInner(props: Props) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<TranscriptMessage[]>([]);
  const conversationIdRef = React.useRef<string | null>(null);
  // Guard so markInterviewStartedAction fires exactly once per connected call,
  // even under React 19 StrictMode double-effects or reconnect flicker.
  const startedRef = React.useRef<string | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setPhase("live");
    },
    onDisconnect: () => {
      // Handled explicitly in endCall below; avoid racing the finalize flow here.
    },
    onMessage: (message: { source?: string; message?: string }) => {
      if (!message?.message) return;
      const role: "user" | "agent" = message.source === "user" ? "user" : "agent";
      setMessages((prev) => [...prev, { role, text: message.message!, at: Date.now() }]);
    },
    onError: (err: unknown) => {
      console.error("ElevenLabs error", err);
      const msg = err instanceof Error ? err.message : String(err ?? "Unknown error");
      setError(msg);
      toast.error("Call error: " + msg);
    },
  });

  const status = conversation.status as "disconnected" | "connecting" | "connected" | undefined;
  const isSpeaking = Boolean(conversation.isSpeaking);

  // ElevenLabs assigns the conversation id during the handshake. Capture it as soon as
  // the session is live so we can still recover it after the WebSocket tears down,
  // and persist it on the InterviewSession row (status → in_progress).
  React.useEffect(() => {
    if (status !== "connected") return;
    let convId: string | null = null;
    try {
      const id = conversation.getId?.();
      if (typeof id === "string" && id.length > 0) {
        conversationIdRef.current = id;
        convId = id;
      }
    } catch {
      /* ignore */
    }
    if (!convId) return;
    if (startedRef.current === convId) return;
    startedRef.current = convId;
    void markInterviewStartedAction({ sessionId: props.sessionId, conversationId: convId }).catch((err) => {
      console.warn("markInterviewStartedAction failed", err);
    });
  }, [status, conversation, props.sessionId]);

  async function startCall() {
    setError(null);
    setMessages([]);
    conversationIdRef.current = null;
    startedRef.current = null;
    setPhase("starting");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("idle");
      const msg = "Mic permission denied. Allow microphone access and try again.";
      setError(msg);
      toast.error(msg);
      return;
    }

    let config: SignedUrlResponse;
    try {
      const res = await fetch("/api/elevenlabs/signed-url", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: props.sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<SignedUrlResponse> & {
        error?: string;
      };
      if (!res.ok || !data.signedUrl || !data.dynamicVariables) {
        throw new Error(data.error ?? `Signed URL error (${res.status})`);
      }
      config = { signedUrl: data.signedUrl, dynamicVariables: data.dynamicVariables };
    } catch (err) {
      console.error(err);
      setPhase("idle");
      const msg = err instanceof Error ? err.message : "Couldn't start the call.";
      setError(msg);
      toast.error(msg);
      return;
    }

    try {
      await conversation.startSession({
        signedUrl: config.signedUrl,
        dynamicVariables: config.dynamicVariables,
      } as Parameters<typeof conversation.startSession>[0]);
      // The id is grabbed reactively when status flips to "connected" above;
      // the same effect also persists it via markInterviewStartedAction.
    } catch (err) {
      console.error(err);
      setPhase("idle");
      const msg = err instanceof Error ? err.message : "Couldn't connect to Maya.";
      setError(msg);
      toast.error(msg);
    }
  }

  async function endCall() {
    if (phase !== "live") return;
    setPhase("finalizing");

    // Capture the id BEFORE tearing down — after endSession the SDK's internal state
    // may be cleared and getId() can start returning empty.
    let conversationId = conversationIdRef.current;
    if (!conversationId) {
      try {
        const fallback = conversation.getId?.();
        if (typeof fallback === "string" && fallback.length > 0) {
          conversationId = fallback;
        }
      } catch {
        /* ignore */
      }
    }

    // Fire-and-forget the teardown. Some SDK builds leave endSession() awaiting a
    // WebRTC close that never resolves — never block the UI on it.
    try {
      void conversation.endSession();
    } catch (err) {
      console.warn("endSession warning", err);
    }

    if (!conversationId) {
      setPhase("idle");
      const msg = "Couldn't identify the call. Please start a fresh interview.";
      setError(msg);
      toast.error(msg);
      return;
    }

    toast.info("Saving your call…");
    const result = await endVoiceCallAction({
      sessionId: props.sessionId,
      conversationId,
    });

    if (!result.ok) {
      setPhase("idle");
      setError(result.message);
      toast.error(result.message);
      return;
    }

    setPhase("ended");
    router.push(result.redirectTo);
  }

  return (
    <div className="grid gap-5">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-6 p-8 text-center sm:p-10">
          <div className="mx-auto flex flex-col items-center gap-4">
            <div
              className={cn(
                "relative flex h-28 w-28 items-center justify-center rounded-full border transition-all",
                phase === "live" && isSpeaking
                  ? "border-primary bg-primary/20 text-primary animate-pulse-ring"
                  : phase === "live"
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : phase === "starting" || phase === "finalizing"
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-border bg-card text-muted-foreground",
              )}
            >
              {phase === "starting" || phase === "finalizing" ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : (
                <Mic className="h-10 w-10" />
              )}
            </div>

            <div>
              <p className="text-lg font-semibold text-foreground">
                {phase === "idle" && "Ready when you are"}
                {phase === "starting" && "Connecting…"}
                {phase === "live" && (isSpeaking ? "Maya is speaking…" : "Your turn")}
                {phase === "finalizing" && "Saving your call…"}
                {phase === "ended" && "Call complete"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {phase === "idle" &&
                  "Press start to call Maya. You can interrupt her any time — just talk."}
                {phase === "live" && "Speak naturally. Maya can hear you."}
                {phase === "finalizing" && "Saving the transcript — this only takes a couple seconds. Feedback will be ready on the next page."}
                {phase === "starting" && "Getting a mic permission and a signed session."}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            {phase === "idle" || phase === "ended" ? (
              <Button size="xl" onClick={startCall}>
                <Phone className="h-4 w-4" />
                Start call with Maya
              </Button>
            ) : null}
            {phase === "starting" ? (
              <Button size="xl" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting…
              </Button>
            ) : null}
            {phase === "live" ? (
              <Button size="xl" variant="destructive" onClick={endCall}>
                <PhoneOff className="h-4 w-4" />
                End call
              </Button>
            ) : null}
            {phase === "finalizing" ? (
              <Button size="xl" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {status === "connected" ? "Connected · Live" : status === "connecting" ? "Connecting…" : null}
          </p>
        </CardContent>
      </Card>

      {messages.length > 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live transcript
            </p>
            <div className="mt-4 grid gap-3">
              {messages.map((m, i) => (
                <div
                  key={`${m.at}-${i}`}
                  className={cn(
                    "rounded-lg px-4 py-3 text-sm leading-6",
                    m.role === "agent"
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-muted/40 text-foreground",
                  )}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {m.role === "agent" ? "Maya" : "You"}
                  </p>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
