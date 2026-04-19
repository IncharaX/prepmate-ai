"use client";

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
      <CardContent className="p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge className="border-cyan-200 bg-cyan-50 text-cyan-800">Score trends</Badge>
          <h2 className="mt-2 text-xl font-bold text-zinc-950">Scores over time</h2>
        </div>
        <p className="text-sm text-zinc-500">Session averages</p>
      </div>

      <div className="mt-6 h-80 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#71717a", fontSize: 12 }} />
            <YAxis
              domain={[0, 10]}
              tickCount={6}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#71717a", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e4e4e7",
                boxShadow: "0 10px 25px rgba(24, 24, 27, 0.08)",
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="content"
              name="Content"
              stroke="#047857"
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="communication"
              name="Communication"
              stroke="#2563eb"
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="confidence"
              name="Confidence"
              stroke="#db2777"
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      </CardContent>
    </Card>
  );
}
