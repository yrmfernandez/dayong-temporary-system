import { NextResponse } from "next/server";

import { getRealSessionUser, getSessionUser } from "@/lib/auth-server";

export async function GET() {
  const [user, active] = await Promise.all([getRealSessionUser(), getSessionUser()]);

  if (!user || !active) {
    return NextResponse.json(
      {
        success: false,
        message: "Not signed in.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    success: true,
    // The account with all its roles: the sidebar lists a workspace for each.
    user: {
      employeeId: user.employeeId,
      name: user.name,
      rolePages: user.rolePages,
      roles: user.roleNames.length ? user.roleNames : user.roles,
      roleIds: user.roles,
      roleNames: user.roleNames,
      permissions: user.permissions,
      rolePermissions: user.rolePermissions,
      mustChangePassword: user.mustChangePassword,
    },
    // The open workspace's role and permissions (lib/workspace-session.ts): screens that change with the role use these.
    active: { roleNames: active.roleNames, permissions: active.permissions },
  });
}
