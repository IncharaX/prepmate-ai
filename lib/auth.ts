import { redirect } from "next/navigation";

import { auth } from "@/auth";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser(returnTo?: string) {
  const user = await getCurrentUser();
  if (!user?.id) {
    const params = returnTo ? `?from=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${params}`);
  }
  return user;
}
