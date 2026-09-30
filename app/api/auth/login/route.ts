import { NextResponse } from "next/server";

import { createSessionToken, SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions } from "@/lib/auth";
import { isWeakPassword } from "@/lib/default-password";
import { checkPassword, ONE_TIME_PASSWORD_HOURS } from "@/lib/passwords";
import { readingFresh } from "@/lib/google-sheets";
import { getLoginUserByEmployeeId } from "@/lib/google-sheets-data";
import { clearAttempts, clientIp, recordAttempt, retryAfter } from "@/lib/rate-limit";
import { sessionFor } from "@/lib/session-account";
import {
  assertServerConfiguration,
  ServerConfigurationError,
} from "@/lib/server-environment";

function googleSheetsLoginMessage(error: unknown) {
  if (!(error instanceof Error)) return null;

  const message = error.message.toLowerCase();
  if (
    message.includes("invalid_grant") ||
    message.includes("invalid jwt") ||
    message.includes("decoder routines") ||
    message.includes("private key")
  ) {
    return "Google service account authentication failed. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in the Vercel Production environment, then redeploy.";
  }

  const status = (error as Error & { code?: number }).code;
  if (status === 403 || message.includes("permission denied")) {
    return "The Google Sheet is not shared with the configured service account. Give its email Editor access, then try again.";
  }

  if (
    status === 404 ||
    message.includes("requested entity was not found")
  ) {
    return "The configured Google Sheet was not found. Check GOOGLE_SHEET_ID in the Vercel Production environment.";
  }

  return null;
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
      message = `${error.message} Add it in the Vercel Production environment and redeploy.`;
      status = 503;
    } else if (
      error instanceof Error &&
      error.message.includes("Google Sheets is temporarily busy")
    ) {
      message = error.message;
      status = 503;
    } else {
      message = googleSheetsLoginMessage(error) ?? message;
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
