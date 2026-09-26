import { withEncoder } from "@/lib/encoder-context";
import bcrypt from "bcryptjs";
import { getEmployees } from "@/lib/employees";
import { NextResponse } from "next/server";

import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { deleteUserAccount, getUserAccounts, updateUserAccount } from "@/lib/master-data-crud";
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

    const employees = await getEmployees();
    const normalizeRole = (value: string) => value.trim().toLowerCase().replace(/^admin$/, "administrator").replace(/^hr$/, "hr officer");
    return NextResponse.json({
      success: true,
      roles,
      accounts: await getUserAccounts(),
      employees: employees.map((employee) => ({
        ...employee,
        roleIds: roles.filter((role) => employee.roles.some((employeeRole) => normalizeRole(employeeRole) === normalizeRole(role.name))).map((role) => role.id),
      })),
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

    let roleIds = Array.isArray(body.roleIds)
        ? body.roleIds.filter(
      (roleId: unknown): roleId is string =>
        typeof roleId === "string",
    )
    : [];

    if (roleIds.length === 0) {
      const roles = await getActiveAccountRoles();
      const normalizeRole = (value: string) => value.trim().toLowerCase().replace(/^admin$/, "administrator").replace(/^hr$/, "hr officer");
      roleIds = roles.filter((role) => employee.roles.some((employeeRole) => normalizeRole(employeeRole) === normalizeRole(role.name))).map((role) => role.id);
    }

    if (password.length < 12) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Password must be at least 12 characters.",
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

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return NextResponse.json({ success: false, message: "You are not allowed to update user accounts." }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.filter((value: unknown): value is string => typeof value === "string") : [];
    return NextResponse.json({ success: true, account: await updateUserAccount(id, { username: typeof body.username === "string" ? body.username : "", status: body.status === "inactive" ? "inactive" : "active", roleIds, password: typeof body.password === "string" ? body.password : "" }) });
  } catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update account." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return NextResponse.json({ success: false, message: "You are not allowed to delete user accounts." }, { status: 403 });
  try {
    const user = await getSessionUser();
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    await deleteUserAccount(id, user?.userId ?? "");
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete account." }, { status: 400 }); }
});
