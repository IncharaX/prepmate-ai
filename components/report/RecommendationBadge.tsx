import { cn } from "@/lib/utils";

export type RecommendationValue = "strong_yes" | "yes" | "maybe" | "no" | "strong_no";

const MAP: Record<RecommendationValue, { label: string; className: string }> = {
  strong_yes: {
    label: "Strong yes",
    className: "bg-primary text-primary-foreground",
  },
  yes: {
    label: "Yes",
    className: "bg-accent text-accent-foreground",
  },
  maybe: {
    label: "Maybe",
    className: "border border-border bg-muted/50 text-foreground",
  },
  no: {
    label: "No",
    className: "bg-destructive/15 text-destructive",
  },
  strong_no: {
    label: "Strong no",
    className: "bg-destructive text-destructive-foreground",
  },
};

export function RecommendationBadge({
  value,
  size = "md",
}: {
  value: RecommendationValue;
  size?: "sm" | "md";
}) {
  const cfg = MAP[value];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
}
