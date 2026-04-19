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
    <Card className="border-emerald-100 shadow-[0_18px_45px_rgba(6,182,212,0.10)]">
      <CardContent className="p-5">
        <Badge className="border-cyan-200 bg-cyan-50 text-cyan-800">Feedback</Badge>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {scoreLabels.map(([label, key]) => (
            <div key={key} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-600">{label}</p>
              <p className="mt-2 text-3xl font-bold text-zinc-950">{score[key]}</p>
              <p className="text-sm text-zinc-500">out of 10</p>
            </div>
          ))}
        </div>
        <p className="mt-5 leading-7 text-zinc-700">{feedback}</p>
      </CardContent>
    </Card>
  );
}
