import { CircleCheck, CircleDashed, CircleHelp, CircleSlash } from "lucide-react";

import { cn } from "@/lib/utils";

export type FitStatusValue = "met" | "partial" | "unclear" | "not_shown";

const MAP: Record<FitStatusValue, { icon: React.ElementType; label: string; className: string }> = {
  met: { icon: CircleCheck, label: "Met", className: "text-primary" },
  partial: { icon: CircleDashed, label: "Partial", className: "text-foreground" },
  unclear: { icon: CircleHelp, label: "Unclear", className: "text-muted-foreground" },
  not_shown: { icon: CircleSlash, label: "Not shown", className: "text-muted-foreground" },
};

export function FitStatusBadge({ status }: { status: FitStatusValue }) {
  const cfg = MAP[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", cfg.className)}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}
