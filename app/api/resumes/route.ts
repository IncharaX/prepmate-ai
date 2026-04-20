import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { parseResumeInBackground } from "@/app/actions/prepare";
import { getCurrentUser } from "@/lib/auth";
import { extractPdfText } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { resumeKey } from "@/lib/storage-keys";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_EXTRACTED_CHARS = 40;

const labelSchema = z
  .string()
  .trim()
  .min(1, { message: "Label can't be empty." })
  .max(120, { message: "Label is too long." })
  .optional();

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resumes = await prisma.resume.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      fileName: true,
      fileSizeBytes: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ resumes });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing `file` field." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Only PDF files are supported for now." },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `File is too large. Max size is ${MAX_PDF_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }

  const labelParsed = labelSchema.safeParse(form.get("label"));
  if (!labelParsed.success) {
    return NextResponse.json(
      { error: labelParsed.error.issues[0]?.message ?? "Invalid label." },
      { status: 400 },
    );
  }
  const rawLabel = (form.get("label") as string | null) ?? "";
  const fileName = file.name || "resume.pdf";
  const labelFromFile = fileName.replace(/\.pdf$/i, "").trim();
  const label = rawLabel.trim() || labelFromFile || "Untitled resume";

  const buffer = Buffer.from(await file.arrayBuffer());

  let extracted: { text: string; pageCount: number };
  try {
    extracted = await extractPdfText(buffer);
  } catch (error) {
    console.error("pdf-parse failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Couldn't read that PDF. Try re-exporting or uploading a different file.",
        detail,
      },
      { status: 400 },
    );
  }

  if (extracted.text.length < MIN_EXTRACTED_CHARS) {
    return NextResponse.json(
      {
        error:
          "We couldn't find enough readable text in that PDF (is it a scanned image?). Try a text-based PDF.",
      },
      { status: 400 },
    );
  }

  // Create the row first so we have an id for the R2 key.
  const created = await prisma.resume.create({
    data: {
      userId: user.id,
      label,
      extractedText: extracted.text,
      fileName,
      fileSizeBytes: file.size,
    },
    select: {
      id: true,
      label: true,
      fileName: true,
      fileSizeBytes: true,
      createdAt: true,
    },
  });

  const key = resumeKey(user.id, created.id);
  try {
    await uploadFile({ key, body: buffer, contentType: "application/pdf", contentLength: file.size });
  } catch (error) {
    console.error("R2 upload failed; rolling back resume row", error);
    // why: the DB row only makes sense if the blob actually landed. No user
    // should see a phantom resume with no file behind it.
    await prisma.resume.delete({ where: { id: created.id } }).catch(() => undefined);
    const rawMessage = error instanceof Error ? error.message : String(error);
    const r2Name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";
    const isConfigError = rawMessage.includes("R2 storage not configured");
    return NextResponse.json(
      {
        error: isConfigError
          ? "File storage isn't configured yet. Ask the admin to set the CLOUDFLARE_R2_* env vars."
          : "Couldn't save the uploaded file. Please try again.",
        detail: isConfigError ? undefined : rawMessage,
        code: isConfigError ? undefined : r2Name || undefined,
      },
      { status: 500 },
    );
  }

  // Record the R2 key on the row so deletion / signed-URL generation can find it.
  await prisma.resume.update({
    where: { id: created.id },
    data: { fileUrl: key },
  });

  // Non-blocking: extract structured parsedData from the resume text after the
  // response has been sent. Failures are swallowed (prep works from raw text).
  after(async () => {
    await parseResumeInBackground(created.id, user.id);
  });

  return NextResponse.json({ resume: created }, { status: 201 });
}
