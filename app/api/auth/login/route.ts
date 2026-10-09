import { NextResponse } from "next/server";

import { createSessionToken, SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions } from "@/lib/auth";
import { isWeakPassword } from "@/lib/default-password";
import { checkPassword, ONE_TIME_PASSWORD_HOURS } from "@/lib/passwords";
import { readingFresh } from "@/lib/google-sheets";
import { getLoginUserByEmployeeId } from "@/lib/google-sheets-data";
import { clearAttempts, clientIp, recordAttempt, retryAfter } from "@/lib/rate-limit";
import { sessionFor } from "@/lib/session-account";
import { BUSY } from "@/lib/sheets-read-cache";
import {
  assertServerConfiguration,
  ServerConfigurationError,
} from "@/lib/server-environment";

/** Where settings must be added, named for this deployment: Vercel sets VERCEL_ENV to production, preview or development. */
function vercelEnvironment() {
  const environment = process.env.VERCEL_ENV;
  if (environment === "preview") return "Vercel Preview environment";
  if (environment === "production") return "Vercel Production environment";
  return environment === "development" ? "Vercel Development environment" : "server environment (.env.local when running locally)";
}

// Failed sign-ins allowed per window before that Employee ID, or that network address, must wait.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAILURES_PER_ACCOUNT = 5;
const FAILURES_PER_IP = 20;

function tooManyAttempts(seconds: number) {
  return NextResponse.json(
    {
      success: false,
      message: `Too many failed sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

export async function POST(request: Request) {
  try {
    assertServerConfiguration();

    const body = await request.json();

    const employeeId =
      typeof body.employeeId === "string"
        ? body.employeeId.trim()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!employeeId || !password) {
      return NextResponse.json(
        {
          success: false,
          message: "Employee ID and password are required.",
        },
        { status: 400 },
      );
    }

    const ipKey = `login-ip:${clientIp(request)}`;
    const accountKey = `login-id:${employeeId.toUpperCase()}`;
    const wait = Math.max(retryAfter(ipKey, FAILURES_PER_IP), retryAfter(accountKey, FAILURES_PER_ACCOUNT));
    if (wait) return tooManyAttempts(wait);
    const failed = () => {
      recordAttempt(ipKey, LOGIN_WINDOW_MS);
      recordAttempt(accountKey, LOGIN_WINDOW_MS);
      return NextResponse.json(
        {
          success: false,
          message: "Invalid Employee ID or password.",
        },
        { status: 401 },
      );
    };

    // Sign-in always reads the current account, password and roles.
    const user = await readingFresh(() => getLoginUserByEmployeeId(employeeId));

    if (!user) {
      return failed();
    }

    const passwordCheck = await checkPassword(password, user.passwordHash);

    if (!passwordCheck.matches) {
      return failed();
    }

    if (passwordCheck.expired) {
      return NextResponse.json(
        {
          success: false,
          message: `This one-time password expired after ${ONE_TIME_PASSWORD_HOURS} hours. Ask IT for a new one.`,
        },
        { status: 401 },
      );
    }

    clearAttempts(accountKey);

    // A one-time, default or weak password still signs in, but only to change it (see proxy.ts).
    const mustChangePassword = passwordCheck.oneTime || isWeakPassword(password);
    const token = await createSessionToken(sessionFor(user, mustChangePassword));

    const response = NextResponse.json({
      success: true,
      mustChangePassword,
      user: {
        employeeId: user.employeeId,
        fullName: user.fullName,
        roles: user.roles.map((role) => role.name),
      },
    });

    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_SECONDS));

    return response;
  } catch (error) {
    console.error("Login error:", error);

    let message = "Unable to sign in. Please try again.";
    let status = 500;

    if (error instanceof ServerConfigurationError) {
      message = `${error.message} Add it in the ${vercelEnvironment()} and redeploy.`;
      status = 503;
    } else if (error instanceof Error && error.message === BUSY) {
      message = error.message;
      status = 503;
    }

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status },
    );
  }
}
