"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { PasteJdDialog } from "./PasteJdDialog";
import type { JdRow } from "./types";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
}

export function JdList({ initialJobDescriptions }: { initialJobDescriptions: JdRow[] }) {
  const router = useRouter();
  const [rows, setRows] = React.useState(initialJobDescriptions);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function handleDelete(id: string) {
    if (deletingId) return;
    const prev = rows;
    setDeletingId(id);
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/job-descriptions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Job description deleted.");
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't delete that JD. Refreshing.");
      setRows(prev);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "No job descriptions yet."
            : `${rows.length} JD${rows.length === 1 ? "" : "s"} saved.`}
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Paste new JD
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 p-8 text-center">
            <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Save your first JD</p>
            <p className="mx-auto max-w-sm text-xs text-muted-foreground">
              Paste the job description once. Reuse it across multiple practice interviews.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((j) => {
              const sub = [j.roleTitle, j.companyName].filter(Boolean).join(" · ");
              const preview = j.rawText.slice(0, 140).replace(/\s+/g, " ");
              return (
                <li key={j.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{j.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[sub, formatDate(j.createdAt)].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete job description"
                    onClick={() => handleDelete(j.id)}
                    disabled={deletingId === j.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <PasteJdDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(row) => {
          setRows((r) => [row, ...r]);
          router.refresh();
        }}
      />
    </div>
  );
}
