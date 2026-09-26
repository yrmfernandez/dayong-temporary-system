import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-server";

export async function GET() {
  const user = await getSessionUser();

  if (!user) {
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
    user: {
      employeeId: user.employeeId,
      username: user.username,
      roles: user.roleNames.length ? user.roleNames : user.roles,
      roleIds: user.roles,
      roleNames: user.roleNames,
      permissions: user.permissions,
    },
  });
}
