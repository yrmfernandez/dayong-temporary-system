import {
  NextRequest,
  NextResponse,
} from "next/server";

import { verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(
    "dayong_session",
  )?.value;

  const session = token
    ? await verifySessionToken(token)
    : null;

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};