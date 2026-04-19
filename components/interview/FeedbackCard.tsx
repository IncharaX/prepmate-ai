import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type FeedbackCardProps = {
  score: {
    content: number;
    communication: number;
    confidence: number;
  };
  feedback: string;
};

const scoreLabels = [
  ["Content", "content"],
  ["Communication", "communication"],
  ["Confidence", "confidence"],
] as const;

export function FeedbackCard({ score, feedback }: FeedbackCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <Badge variant="muted">
          <Sparkles className="h-3 w-3" />
          Feedback
        </Badge>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {scoreLabels.map(([label, key]) => (
            <div key={key} className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {score[key]}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/10</span>
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm leading-6 text-foreground">{feedback}</p>
      </CardContent>
    </Card>
  );
}
