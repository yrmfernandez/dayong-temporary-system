import { withEncoder } from "@/lib/encoder-context";
import { getEmployees, setEmployeeRoles } from "@/lib/employees";
import { NextResponse } from "next/server";
import { createDefaultAccount } from "@/lib/employee-accounts";

import { canManageAccounts, getSessionUser } from "@/lib/auth-server";
import { deleteUserAccount, getUserAccounts, updateUserAccount } from "@/lib/master-data-crud";
import { getActiveAccountRoles } from "@/lib/google-sheets-data";
import { guardAccountChange } from "@/lib/privilege-guard";

export async function GET() {
  try {
    const allowed = await canManageAccounts();

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
    const allowed = await canManageAccounts();

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

    // Accounts start with a one-time password shown only in this response; the person replaces it at first sign-in.
    const roleIds: string[] = Array.isArray(body.roleIds)
      ? [...new Set<string>(body.roleIds.filter((roleId: unknown): roleId is string => typeof roleId === "string").map((roleId: string) => roleId.trim()).filter(Boolean))]
      : [];
    const denied = await guardAccountChange({ roleIds });
    if (denied) return NextResponse.json({ success: false, message: denied }, { status: 403 });
    const result = await createDefaultAccount(employee, roleIds);
    if (!result.created) return NextResponse.json({ success: false, message: result.reason }, { status: 400 });
    const user = { id: result.userId, employeeId: employee.id, fullName: employee.name, roleIds: result.roleIds, oneTimePassword: result.oneTimePassword, expiresAt: result.expiresAt };

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
  if (!(await canManageAccounts())) return NextResponse.json({ success: false, message: "You are not allowed to update user accounts." }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.filter((value: unknown): value is string => typeof value === "string") : [];
    const denied = await guardAccountChange({ roleIds, accountId: id });
    if (denied) return NextResponse.json({ success: false, message: denied }, { status: 403 });
    const account = await updateUserAccount(id, { status: body.status === "inactive" ? "inactive" : "active", roleIds });
    // The register follows the account, so the two cannot drift apart (see System Health).
    const [accounts, roles] = await Promise.all([getUserAccounts(), getActiveAccountRoles()]);
    const saved = accounts.find((item) => item.id === id);
    if (saved?.employeeId) await setEmployeeRoles(saved.employeeId, saved.roleIds.map((roleId) => roles.find((role) => role.id === roleId)?.name ?? roleId));
    return NextResponse.json({ success: true, account });
  } catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update account." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageAccounts())) return NextResponse.json({ success: false, message: "You are not allowed to delete user accounts." }, { status: 403 });
  try {
    const user = await getSessionUser();
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const denied = await guardAccountChange({ accountId: id });
    if (denied) return NextResponse.json({ success: false, message: denied }, { status: 403 });
    await deleteUserAccount(id, user?.userId ?? "");
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete account." }, { status: 400 }); }
});
