import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionMaxAge,
  type SessionUser,
  verifySessionToken,
} from "@/lib/auth";
import { canAccessPath } from "@/lib/access-control";
import { recheckSession, SESSION_RECHECK_MS } from "@/lib/session-account";

// API routes reachable without a session. Every other /api route needs a valid sign-in before its handler runs;
// handlers still check their own page or action permission.
const publicApi = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/session"]);
// All a session may use while its password must be changed: the Settings page and what it loads.
const passwordChangeApi = new Set([...publicApi, "/api/settings", "/api/profile"]);
const passwordChangePage = "/settings";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Browsers send Origin on every cross-site write; server-side callers without it carry no user's cookie.
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// When the sheets cannot be read, sessions carry on unchecked for a minute rather than every request waiting on retries.
let recheckPausedUntil = 0;

type SessionState = { session: SessionUser | null; refreshedToken?: string; revoked?: boolean };

/**
 * The request's session. Every few minutes it is confirmed against the Users sheet, so a deactivated account, a
 * changed or reset password, or removed roles take effect within minutes instead of when the 8-hour session ends.
 */
async function readSession(request: NextRequest): Promise<SessionState> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!token) return { session: null };
  if (!session) return { session: null, revoked: true };
  if (Date.now() - session.checkedAt < SESSION_RECHECK_MS || Date.now() < recheckPausedUntil) return { session };
  try {
    const current = await recheckSession(session);
    if (!current) return { session: null, revoked: true };
    return { session: current, refreshedToken: await createSessionToken(current) };
  } catch (error) {
    console.error("Session recheck failed; continuing with the signed session:", error);
    recheckPausedUntil = Date.now() + 60_000;
    return { session };
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { session, refreshedToken, revoked } = await readSession(request);

  // Handlers in this request read the refreshed session too.
  if (refreshedToken) request.cookies.set(SESSION_COOKIE, refreshedToken);
  const finish = (response: NextResponse) => {
    if (refreshedToken && session) response.cookies.set(SESSION_COOKIE, refreshedToken, sessionCookieOptions(sessionMaxAge(session)));
    else if (revoked) response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
    return response;
  };
  const next = () => NextResponse.next({ request: { headers: request.headers } });

  if (pathname.startsWith("/api/")) {
    // Writes must come from this site's own pages, so another site cannot submit them with a signed-in user's cookie.
    if (!safeMethods.has(request.method) && !isSameOrigin(request)) {
      return NextResponse.json({ success: false, message: "Cross-site requests are not allowed." }, { status: 403 });
    }
    if (!session && !publicApi.has(pathname)) {
      return finish(NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 }));
    }
    if (session?.mustChangePassword && !passwordChangeApi.has(pathname)) {
      return finish(NextResponse.json({ success: false, passwordChangeRequired: true, message: "Change your password in Settings → Security before continuing." }, { status: 403 }));
    }
    // API data is per user and confidential: never store it in browser, proxy or CDN caches.
    const response = next();
    response.headers.set("Cache-Control", "private, no-store");
    return finish(response);
  }

  if (pathname === "/login") {
    if (session) {
      return finish(NextResponse.redirect(
        new URL("/", request.url),
      ));
    }

    return finish(next());
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

    return finish(NextResponse.redirect(loginUrl));
  }

  if (session.mustChangePassword) {
    if (pathname === passwordChangePage) return finish(next());
    const settingsUrl = new URL(passwordChangePage, request.url);
    settingsUrl.searchParams.set("tab", "security");
    settingsUrl.searchParams.set("required", "1");
    return finish(NextResponse.redirect(settingsUrl));
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
    return finish(NextResponse.redirect(new URL("/", request.url)));
  }

  return finish(next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|dayong-logo.png|robots.txt).*)",
  ],
};
