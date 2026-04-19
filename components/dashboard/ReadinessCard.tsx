import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type ReadinessCardProps = {
  score: number;
  sessionCount: number;
  answerCount: number;
};

export function ReadinessCard({ score, sessionCount, answerCount }: ReadinessCardProps) {
  return (
    <Card className="border-emerald-100 shadow-[0_18px_45px_rgba(16,185,129,0.10)]">
      <CardContent className="p-5">
        <Badge>Interview readiness</Badge>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-5xl font-bold tracking-tight text-zinc-950">{score}</p>
            <p className="mt-1 text-sm text-zinc-500">average score out of 10</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-56">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-2xl font-bold text-zinc-950">{sessionCount}</p>
              <p className="text-sm text-zinc-500">sessions</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-2xl font-bold text-zinc-950">{answerCount}</p>
              <p className="text-sm text-zinc-500">answers</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
