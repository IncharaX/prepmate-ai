import { redirect } from "next/navigation";

import { auth } from "@/auth";

// After the schema v2 migration, user IDs are UUIDs. Existing JWTs from before
// the migration still carry cuid-format IDs, and those will explode when Prisma
// tries to cast them into a UUID column. Detect and redirect to login instead
// of 500ing.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCurrentUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  if (!UUID_RE.test(user.id)) return null; // stale pre-v2 JWT
  return user;
}

export async function requireUser(returnTo?: string) {
  const user = await getCurrentUser();
  if (!user?.id) {
    const params = returnTo ? `?from=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${params}`);
  }
  return user;
}
