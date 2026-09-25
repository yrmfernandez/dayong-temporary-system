import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { createSessionToken } from "@/lib/auth";
import { getLoginUserByUsername } from "@/lib/google-sheets-data";
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

    const username =
      typeof body.username === "string"
        ? body.username.trim()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!username || !password) {
      return NextResponse.json(
        {
          success: false,
          message: "Username and password are required.",
        },
        { status: 400 },
      );
    }

    const user = await getLoginUserByUsername(username);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid username or password.",
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
          message: "Invalid username or password.",
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

    const token = await createSessionToken({
      userId: user.id,
      employeeId: user.employeeId,
      username: user.username,
      roles: user.roles.map((role) => role.id),
      permissions,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        employeeId: user.employeeId,
        username: user.username,
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
