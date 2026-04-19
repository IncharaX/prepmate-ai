import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type QuestionCardProps = {
  question: string;
};

export function QuestionCard({ question }: QuestionCardProps) {
  return (
    <Card className="border-emerald-100 shadow-[0_18px_45px_rgba(16,185,129,0.10)]">
      <CardContent className="p-5">
        <Badge>AI question</Badge>
        <p className="mt-4 text-lg font-semibold leading-7 text-zinc-950">{question}</p>
      </CardContent>
    </Card>
  );
}
