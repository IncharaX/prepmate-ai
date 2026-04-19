import { Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type ReadinessCardProps = {
  score: number;
  sessionCount: number;
  answerCount: number;
};

export function ReadinessCard({ score, sessionCount, answerCount }: ReadinessCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <Badge variant="success">
          <Trophy className="h-3 w-3" />
          Interview readiness
        </Badge>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-5xl font-bold tracking-tight text-gradient-primary">{score}</p>
            <p className="mt-1 text-sm text-muted-foreground">average score out of 10</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-56">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-2xl font-bold text-foreground">{sessionCount}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">sessions</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-2xl font-bold text-foreground">{answerCount}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">answers</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
