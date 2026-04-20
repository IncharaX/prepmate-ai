import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { parseJdInBackground } from "@/app/actions/prepare";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createJdSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, { message: "Label can't be empty." })
    .max(120, { message: "Label is too long." })
    .optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
  roleTitle: z.string().trim().min(1).max(120).optional(),
  rawText: z
    .string()
    .min(40, { message: "Paste the full job description (at least 40 characters)." })
    .max(20000, { message: "JD is too long." }),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobDescriptions = await prisma.jobDescription.findMany({
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
  });
  return NextResponse.json({ jobDescriptions });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const parsed = createJdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const derivedLabel =
    data.label ?? (data.roleTitle && data.companyName
      ? `${data.roleTitle} — ${data.companyName}`
      : data.roleTitle ?? data.companyName ?? "Untitled JD");

  const jd = await prisma.jobDescription.create({
    data: {
      userId: user.id,
      label: derivedLabel,
      companyName: data.companyName,
      roleTitle: data.roleTitle,
      rawText: data.rawText,
    },
    select: {
      id: true,
      label: true,
      companyName: true,
      roleTitle: true,
      rawText: true,
      createdAt: true,
    },
  });

  after(async () => {
    await parseJdInBackground(jd.id, user.id);
  });

  return NextResponse.json({ jobDescription: jd }, { status: 201 });
}
