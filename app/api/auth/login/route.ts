import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { createSessionToken } from "@/lib/auth";
import { getLoginUserByUsername } from "@/lib/google-sheets-data";

export async function POST(request: Request) {
  try {
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

    return NextResponse.json(
      {
        success: false,
        message: "Unable to sign in. Please try again.",
      },
      { status: 500 },
    );
  }
}