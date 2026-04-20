"use client";

import * as React from "react";
import { Briefcase, Plus } from "lucide-react";

import { PasteJdDialog } from "@/app/dashboard/library/PasteJdDialog";
import type { JdRow } from "@/app/dashboard/library/types";
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

export function JdSelectDialog({
  open,
  onOpenChange,
  jobDescriptions,
  selectedId,
  onSelect,
  onJdCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  jobDescriptions: JdRow[];
  selectedId: string | null;
  onSelect: (row: JdRow) => void;
  onJdCreated: (row: JdRow) => void;
}) {
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(selectedId);

  function handleConfirm() {
    const row = jobDescriptions.find((j) => j.id === pending);
    if (!row) return;
    onSelect(row);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pick a job description</DialogTitle>
            <DialogDescription>
              Use one you&apos;ve saved, or paste a new one — it&apos;ll land in your library for next time.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {jobDescriptions.length === 0
                ? "No job descriptions yet."
                : `${jobDescriptions.length} in your library`}
            </p>
            <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
              <Plus className="h-4 w-4" />
              Paste new
            </Button>
          </div>

          {jobDescriptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Paste your first JD to get started.
            </div>
          ) : (
            <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
              {jobDescriptions.map((j) => {
                const active = pending === j.id;
                const sub = [j.roleTitle, j.companyName].filter(Boolean).join(" · ");
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setPending(j.id)}
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
                        <Briefcase className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{j.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[sub, formatDate(j.createdAt)].filter(Boolean).join(" · ")}
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
              Use this JD
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasteJdDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onCreated={(row) => {
          onJdCreated(row);
          setPending(row.id);
        }}
      />
    </>
  );
}
