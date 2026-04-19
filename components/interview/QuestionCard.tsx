import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type QuestionCardProps = {
  question: string;
  index?: number;
  total?: number;
};

export function QuestionCard({ question, index, total }: QuestionCardProps) {
  return (
    <Card className="border-primary/20">
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <Badge variant="success">
            <MessageSquare className="h-3 w-3" />
            {typeof index === "number" && typeof total === "number"
              ? `Question ${index} of ${total}`
              : "Maya asks"}
          </Badge>
        </div>
        <p className="mt-4 text-lg font-medium leading-7 text-foreground">{question}</p>
      </CardContent>
    </Card>
  );
}
