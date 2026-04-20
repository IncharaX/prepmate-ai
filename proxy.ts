import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";

const PROTECTED_PREFIXES = ["/dashboard", "/interview"];
const AUTH_ROUTES = ["/login", "/signup"];

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Public shareable report pages live at /report/[token]. Auth-gating them
  // would break the whole feature — anyone with the URL can read the report.
  if (pathname.startsWith("/report/")) {
    return NextResponse.next();
  }

  const session = await auth();
  const isAuthed = Boolean(session?.user);

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (isProtected && !isAuthed) {
    const url = new URL("/login", request.url);
    url.searchParams.set("from", pathname + search);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && isAuthed) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)).*)"],
};
