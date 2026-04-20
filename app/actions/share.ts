"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

/** 32 URL-safe chars, ~192 bits of entropy. */
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

function buildPublicUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/report/${token}`;
}

/**
 * Assert the given ReportCard belongs to the signed-in user (via ReportCard →
 * InterviewSession → userId). Returns the session id on success; throws when
 * the card doesn't exist or isn't the caller's.
 */
async function requireOwnedReportCard(userId: string, reportCardId: string) {
  const card = await prisma.reportCard.findFirst({
    where: { id: reportCardId, session: { userId } },
    select: { id: true, sessionId: true },
  });
  if (!card) {
    throw new Error("Report card not found.");
  }
  return card;
}

export type CreateShareLinkResult =
  | { ok: true; id: string; token: string; url: string }
  | { ok: false; message: string };

export async function createShareLinkAction(reportCardId: string): Promise<CreateShareLinkResult> {
  const user = await requireUser();

  let card;
  try {
    card = await requireOwnedReportCard(user.id, reportCardId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Report card not found." };
  }

  // One retry on the theoretical unique-violation is more than enough; 192 bits
  // of entropy means a collision is effectively impossible but being defensive
  // costs nothing.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = mintToken();
    try {
      const row = await prisma.reportShareLink.create({
        data: { reportCardId: card.id, token },
        select: { id: true, token: true },
      });
      revalidatePath(`/dashboard/interview/${card.sessionId}`);
      return { ok: true, id: row.id, token: row.token, url: buildPublicUrl(row.token) };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "P2002") {
        console.error("createShareLinkAction failed", err);
        return { ok: false, message: "Couldn't create the share link." };
      }
      // P2002 = unique constraint violation on `token`. Loop and retry once.
    }
  }
  return { ok: false, message: "Couldn't mint a unique token. Please try again." };
}

export type RevokeShareLinkResult = { ok: true } | { ok: false; message: string };

export async function revokeShareLinkAction(shareLinkId: string): Promise<RevokeShareLinkResult> {
  const user = await requireUser();
  const existing = await prisma.reportShareLink.findFirst({
    where: {
      id: shareLinkId,
      reportCard: { session: { userId: user.id } },
    },
    select: { id: true, reportCard: { select: { sessionId: true } } },
  });
  if (!existing) return { ok: false, message: "Share link not found." };

  await prisma.reportShareLink.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  revalidatePath(`/dashboard/interview/${existing.reportCard.sessionId}`);
  return { ok: true };
}

export type CurrentShareLink = {
  id: string;
  token: string;
  url: string;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
};

/**
 * Most-recent non-revoked link for a ReportCard the caller owns.
 * Returns null when no live link exists.
 */
export async function getCurrentShareLink(
  reportCardId: string,
): Promise<CurrentShareLink | null> {
  const user = await requireUser();
  const row = await prisma.reportShareLink.findFirst({
    where: {
      reportCardId,
      revokedAt: null,
      reportCard: { session: { userId: user.id } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      viewCount: true,
      lastViewedAt: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  return { ...row, url: buildPublicUrl(row.token) };
}

/**
 * Returns a 1-hour presigned R2 URL for the session's full audio, or null if
 * the session has no `fullAudioUrl` set or signing fails. Owner-only.
 */
export async function getAudioSignedUrl(sessionId: string): Promise<string | null> {
  const user = await requireUser();
  const session = await prisma.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { fullAudioUrl: true },
  });
  if (!session?.fullAudioUrl) return null;
  try {
    return await getSignedDownloadUrl(session.fullAudioUrl, 60 * 60);
  } catch (err) {
    console.warn("getAudioSignedUrl failed", err);
    return null;
  }
}
