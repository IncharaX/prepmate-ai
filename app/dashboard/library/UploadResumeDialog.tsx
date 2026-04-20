"use client";

import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ResumeRow } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;

export function UploadResumeDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onUploaded: (row: ResumeRow) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setFile(null);
    setLabel("");
    setError(null);
    setPending(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!file) {
      setError("Pick a PDF to upload.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Only PDFs are supported right now.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is over 10 MB. Please compress or export a smaller PDF.");
      return;
    }

    const form = new FormData();
    form.set("file", file);
    if (label.trim()) form.set("label", label.trim());

    setPending(true);
    try {
      const res = await fetch("/api/resumes", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { resume?: ResumeRow; error?: string };
      if (!res.ok || !body.resume) {
        throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
      }
      toast.success("Resume uploaded.");
      onUploaded({ ...body.resume, createdAt: new Date(body.resume.createdAt).toISOString() });
      onOpenChange(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload resume</DialogTitle>
          <DialogDescription>PDF only, up to 10 MB. We read the text — not images.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="resume-file">PDF file</Label>
            <Input
              id="resume-file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={pending}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="resume-label">Label (optional)</Label>
            <Input
              id="resume-label"
              placeholder="e.g. Senior frontend — 2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the file name. You can change this later.
            </p>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {pending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
