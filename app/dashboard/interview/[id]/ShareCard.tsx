"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Eye, Loader2, Link2, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  createShareLinkAction,
  revokeShareLinkAction,
  type CurrentShareLink,
} from "@/app/actions/share";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  reportCardId: string;
  initialLink: CurrentShareLink | null;
};

export function ShareCard({ reportCardId, initialLink }: Props) {
  const router = useRouter();
  const [link, setLink] = React.useState<CurrentShareLink | null>(initialLink);
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const result = await createShareLinkAction(reportCardId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setLink({
        id: result.id,
        token: result.token,
        url: result.url,
        viewCount: 0,
        lastViewedAt: null,
        createdAt: new Date(),
      });
      // Auto-copy for convenience. Users expect the link in their clipboard the
      // moment they create it.
      try {
        await navigator.clipboard.writeText(result.url);
        setCopied(true);
        toast.success("Link created and copied to your clipboard.");
      } catch {
        toast.success("Link created.");
      }
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!link || revoking) return;
    setRevoking(true);
    try {
      const result = await revokeShareLinkAction(link.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setLink(null);
      toast.success("Share link revoked. Anyone with the old URL now sees a 404.");
      router.refresh();
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Clipboard blocked. Select the URL manually.");
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Share this report
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Anyone with the link can view the report — no sign-in. Revoke any time.
            </p>
          </div>
          <Link2 className="h-4 w-4 text-muted-foreground" />
        </div>

        {link ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
              />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                {link.viewCount} {link.viewCount === 1 ? "view" : "views"}
                {link.lastViewedAt ? ` · last viewed ${formatRelative(link.lastViewedAt)}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRevoke}
                disabled={revoking}
                className="text-destructive hover:text-destructive"
              >
                {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Revoke
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={handleCreate} disabled={creating} className="justify-self-start">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Create shareable link
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
