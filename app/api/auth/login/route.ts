import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { createSessionToken } from "@/lib/auth";
import { readingFresh } from "@/lib/google-sheets";
import { getLoginUserByEmployeeId } from "@/lib/google-sheets-data";
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

    // Sign-in always reads the current account, password and roles.
    const user = await readingFresh(() => getLoginUserByEmployeeId(employeeId));

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid Employee ID or password.",
        },
        { status: 401 },
      );
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid Employee ID or password.",
        },
        { status: 401 },
      );
    }

    const permissions = {
      manageUsers: user.roles.some(
        (role) => role.manageUsers,
      ),

      manageAttendance: user.roles.some(
        (role) => role.manageAttendance,
      ),

      viewAttendanceReports: user.roles.some(
        (role) => role.viewAttendanceReports,
      ),
    };

    // Only roles with configured page access are listed; the rest use their default pages.
    const rolePages = Object.fromEntries(
      user.roles
        .filter((role) => role.pages)
        .map((role) => [role.name.trim().toLowerCase(), role.pages as string[]]),
    );

    const token = await createSessionToken({
      userId: user.id,
      employeeId: user.employeeId,
      name: user.fullName || user.employeeId,
      roles: user.roles.map((role) => role.id),
      roleNames: user.roles.map((role) => role.name),
      permissions,
      rolePages,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        employeeId: user.employeeId,
        fullName: user.fullName,
        roles: user.roles.map((role) => role.name),
      },
    });

    response.cookies.set("dayong_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

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
