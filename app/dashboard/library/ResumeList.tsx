"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { UploadResumeDialog } from "./UploadResumeDialog";
import type { ResumeRow } from "./types";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
}

function formatBytes(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ResumeList({ initialResumes }: { initialResumes: ResumeRow[] }) {
  const router = useRouter();
  const [rows, setRows] = React.useState(initialResumes);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function handleDelete(id: string) {
    if (deletingId) return;
    const prev = rows;
    setDeletingId(id);
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/resumes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Resume deleted.");
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't delete that resume. Refreshing.");
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
            ? "No resumes yet."
            : `${rows.length} resume${rows.length === 1 ? "" : "s"} in your library.`}
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Upload resume
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 p-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Upload your first resume</p>
            <p className="mx-auto max-w-sm text-xs text-muted-foreground">
              Paste or drop a PDF. Maya reads the text and asks questions grounded in your actual experience.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const sizeLabel = formatBytes(r.fileSizeBytes);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{r.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.fileName, sizeLabel, formatDate(r.createdAt)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete resume"
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <UploadResumeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUploaded={(row) => {
          setRows((r) => [row, ...r]);
          router.refresh();
        }}
      />
    </div>
  );
}
