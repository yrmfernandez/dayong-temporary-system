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
      roles: user.roles,
      permissions: user.permissions,
    },
  });
}