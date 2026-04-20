import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const jd = await prisma.jobDescription.findFirst({
    where: { id: idParse.data, userId: user.id },
    select: {
      id: true,
      label: true,
      companyName: true,
      roleTitle: true,
      rawText: true,
      createdAt: true,
    },
  });
  if (!jd) return NextResponse.json({ error: "Job description not found." }, { status: 404 });

  return NextResponse.json({ jobDescription: jd });
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

  const owned = await prisma.jobDescription.findFirst({
    where: { id: idParse.data, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Job description not found." }, { status: 404 });

  await prisma.jobDescription.delete({ where: { id: owned.id } });
  return NextResponse.json({ ok: true });
}
