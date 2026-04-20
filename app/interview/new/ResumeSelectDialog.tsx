"use client";

import * as React from "react";
import { FileText, Plus } from "lucide-react";

import { UploadResumeDialog } from "@/app/dashboard/library/UploadResumeDialog";
import type { ResumeRow } from "@/app/dashboard/library/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
}

export function ResumeSelectDialog({
  open,
  onOpenChange,
  resumes,
  selectedId,
  onSelect,
  onResumeCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  resumes: ResumeRow[];
  selectedId: string | null;
  onSelect: (row: ResumeRow) => void;
  onResumeCreated: (row: ResumeRow) => void;
}) {
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(selectedId);

  function handleConfirm() {
    const row = resumes.find((r) => r.id === pending);
    if (!row) return;
    onSelect(row);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pick a resume</DialogTitle>
            <DialogDescription>
              Use one from your library, or upload a new PDF — it&apos;ll be saved for reuse.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {resumes.length === 0 ? "No resumes yet." : `${resumes.length} in your library`}
            </p>
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" />
              Upload new
            </Button>
          </div>

          {resumes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Upload your first PDF to get started.
            </div>
          ) : (
            <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
              {resumes.map((r) => {
                const active = pending === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPending(r.id)}
                    className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary">
                      {active ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </div>
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{r.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[r.fileName, formatDate(r.createdAt)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!pending}>
              Use this resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UploadResumeDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(row) => {
          onResumeCreated(row);
          setPending(row.id);
        }}
      />
    </>
  );
}
