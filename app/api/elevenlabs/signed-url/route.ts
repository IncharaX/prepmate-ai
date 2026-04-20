import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getElevenLabsSignedUrl } from "@/lib/elevenlabs";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { signedUrl, agentId } = await getElevenLabsSignedUrl();
    return NextResponse.json({ signedUrl, agentId });
  } catch (error) {
    console.error("signed-url error", error);
    const message = error instanceof Error ? error.message : "Failed to get signed URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
