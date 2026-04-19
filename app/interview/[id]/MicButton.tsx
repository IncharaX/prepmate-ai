"use client";

import { Mic, Square } from "lucide-react";

import { cn } from "@/lib/utils";

export function MicButton({
  listening,
  disabled,
  onToggle,
}: {
  listening: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop recording" : "Start recording"}
      className={cn(
        "relative flex h-20 w-20 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        listening
          ? "border-destructive/60 bg-destructive text-destructive-foreground animate-pulse-ring"
          : "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {listening ? <Square className="h-7 w-7" fill="currentColor" /> : <Mic className="h-7 w-7" />}
    </button>
  );
}
