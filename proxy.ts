import {
  NextRequest,
  NextResponse,
} from "next/server";

import { verifySessionToken } from "@/lib/auth";
import { canAccessPath } from "@/lib/access-control";

// API routes reachable without a session. Every other /api route needs a valid sign-in before its handler runs;
// handlers still check their own page or action permission.
const publicApi = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/session"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(
    "dayong_session",
  )?.value;

  const session = token
    ? await verifySessionToken(token)
    : null;

  if (pathname.startsWith("/api/")) {
    if (session || publicApi.has(pathname)) return NextResponse.next();
    return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
  }

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(
        new URL("/", request.url),
      );
    }

    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL(
      "/login",
      request.url,
    );

    loginUrl.searchParams.set(
      "next",
      pathname,
    );

    return NextResponse.redirect(loginUrl);
  }

  if (
    pathname !== "/" &&
    !canAccessPath(
      {
        roleNames: session.roleNames,
        permissions: session.permissions,
        rolePages: session.rolePages,
      },
      pathname,
    )
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|dayong-logo.png).*)",
  ],
};
