import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await context.params;
  const idParse = idSchema.safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  // findFirst so the soft-delete extension filters deleted rows.
  const resume = await prisma.resume.findFirst({
    where: { id: idParse.data, userId: user.id },
    select: {
      id: true,
      label: true,
      fileName: true,
      fileSizeBytes: true,
      fileUrl: true,
      createdAt: true,
    },
  });

  if (!resume) return NextResponse.json({ error: "Resume not found." }, { status: 404 });

  let signedUrl: string | null = null;
  if (resume.fileUrl) {
    try {
      signedUrl = await getSignedDownloadUrl(resume.fileUrl);
    } catch (error) {
      console.error("Failed to sign R2 url", error);
    }
  }

  return NextResponse.json({
    resume: {
      id: resume.id,
      label: resume.label,
      fileName: resume.fileName,
      fileSizeBytes: resume.fileSizeBytes,
      createdAt: resume.createdAt,
      signedUrl,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await context.params;
  const idParse = idSchema.safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const owned = await prisma.resume.findFirst({
    where: { id: idParse.data, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Resume not found." }, { status: 404 });

  // lib/prisma.ts's soft-delete extension rewrites this to update({ deletedAt: now() }).
  await prisma.resume.delete({ where: { id: owned.id } });
  return NextResponse.json({ ok: true });
}
