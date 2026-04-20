"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

import type { JdRow } from "./types";

export function PasteJdDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreated: (row: JdRow) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [rawText, setRawText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setLabel("");
    setCompanyName("");
    setRoleTitle("");
    setRawText("");
    setError(null);
    setPending(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (rawText.trim().length < 40) {
      setError("Paste the full job description (at least 40 characters).");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/job-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          companyName: companyName.trim() || undefined,
          roleTitle: roleTitle.trim() || undefined,
          rawText: rawText.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        jobDescription?: JdRow;
        error?: string;
      };
      if (!res.ok || !body.jobDescription) {
        throw new Error(body.error ?? `Save failed (HTTP ${res.status})`);
      }
      toast.success("Job description saved.");
      onCreated({
        ...body.jobDescription,
        createdAt: new Date(body.jobDescription.createdAt).toISOString(),
      });
      onOpenChange(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste job description</DialogTitle>
          <DialogDescription>
            Paste the whole JD — responsibilities, requirements, stack. Maya uses it verbatim.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="jd-role">Role title (optional)</Label>
              <Input
                id="jd-role"
                placeholder="Senior Full-stack Engineer"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                maxLength={120}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jd-company">Company (optional)</Label>
              <Input
                id="jd-company"
                placeholder="Stripe"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                maxLength={120}
                disabled={pending}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="jd-label">Custom label (optional)</Label>
            <Input
              id="jd-label"
              placeholder="Falls back to 'Role — Company'"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              disabled={pending}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="jd-text">Job description text</Label>
            <Textarea
              id="jd-text"
              rows={12}
              placeholder="Paste the full JD here. Keep responsibilities, tech stack, seniority, team context."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={pending}
              className="min-h-48"
            />
            <p className="text-xs text-muted-foreground">
              {rawText.length} characters · min 40
            </p>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || rawText.trim().length < 40}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {pending ? "Saving..." : "Save JD"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
