import { withEncoder } from "@/lib/encoder-context";
import bcrypt from "bcryptjs";
import { getEmployees } from "@/lib/employees";
import { NextResponse } from "next/server";

import { canManageUsers } from "@/lib/auth-server";
import {
  createEmployeeAccount,
  getActiveAccountRoles,
} from "@/lib/google-sheets-data";

export async function GET() {
  try {
    const allowed = await canManageUsers();

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to manage user accounts.",
        },
        { status: 403 },
      );
    }

    const roles = await getActiveAccountRoles();

    return NextResponse.json({
      success: true,
      roles,
      employees: await getEmployees(),
    });
  } catch (error) {
    console.error("Load user-account roles error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to load roles.",
      },
      { status: 500 },
    );
  }
}

export const POST = withEncoder(async function POST(request: Request) {
  try {
    const allowed = await canManageUsers();

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to create user accounts.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const employee = (await getEmployees()).find((e) => e.id === employeeId && e.status.toLowerCase() === "active");
    if (!employee) return NextResponse.json({ success: false, message: "Select an active registered employee." }, { status: 400 });

    const username =
      typeof body.username === "string"
        ? body.username
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    const roleIds = Array.isArray(body.roleIds)
        ? body.roleIds.filter(
      (roleId: unknown): roleId is string =>
        typeof roleId === "string",
    )
    : [];

    if (password.length < 8) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Password must be at least 8 characters.",
        },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(
      password,
      12,
    );

    const user = await createEmployeeAccount({
      employeeId,
      username,
      fullName: employee.name,
      passwordHash,
      roleIds,
    });

    return NextResponse.json(
      {
        success: true,
        user,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create user account error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to create the user account.",
      },
      { status: 500 },
    );
  }
});
