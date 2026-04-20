import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Badge } from "@/components/ui/badge";

import { LibraryTabs } from "./LibraryTabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library",
};

export default async function LibraryPage() {
  const user = await requireUser("/dashboard/library");

  const [resumes, jobDescriptions] = await Promise.all([
    prisma.resume.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        fileName: true,
        fileSizeBytes: true,
        createdAt: true,
      },
    }),
    prisma.jobDescription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        companyName: true,
        roleTitle: true,
        rawText: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <DashboardShell user={user} active="library">
      <header className="grid gap-2 rounded-xl border border-border bg-card p-6 shadow-sm">
        <Badge variant="success">Library</Badge>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Resumes &amp; job descriptions</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Upload each resume once, save each JD once. Reuse them across interviews so Maya has the
          context without you pasting the same thing every time.
        </p>
      </header>

      <LibraryTabs
        initialResumes={resumes.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
        initialJobDescriptions={jobDescriptions.map((j) => ({
          ...j,
          createdAt: j.createdAt.toISOString(),
        }))}
      />
    </DashboardShell>
  );
}
