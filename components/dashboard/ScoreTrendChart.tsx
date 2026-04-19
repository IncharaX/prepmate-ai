"use client";

import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type ScoreTrendPoint = {
  label: string;
  content: number;
  communication: number;
  confidence: number;
};

type ScoreTrendChartProps = {
  data: ScoreTrendPoint[];
};

export function ScoreTrendChart({ data }: ScoreTrendChartProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="muted">
              <TrendingUp className="h-3 w-3" />
              Score trends
            </Badge>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Scores over time</h2>
          </div>
          <p className="text-sm text-muted-foreground">Session averages</p>
        </div>

        <div className="mt-6 h-80 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={data} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                domain={[0, 10]}
                tickCount={6}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.08)",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="content"
                name="Content"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="communication"
                name="Communication"
                stroke="var(--chart-2)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="confidence"
                name="Confidence"
                stroke="var(--chart-4)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
