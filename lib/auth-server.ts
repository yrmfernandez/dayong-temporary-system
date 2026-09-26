import { cookies } from "next/headers";

import {
  type SessionUser,
  verifySessionToken,
} from "@/lib/auth";

export async function getSessionUser(): Promise<
  SessionUser | null
> {
  const cookieStore = await cookies();

  const token = cookieStore.get(
    "dayong_session",
  )?.value;

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function canManageUsers() {
  const user = await getSessionUser();
  const roles = user?.roleNames.map((role) => role.trim().toLowerCase()) ?? [];
  return Boolean(user?.permissions.manageUsers || roles.includes("administrator") || roles.includes("admin"));
}

export async function canManageAttendance() {
  const user = await getSessionUser();

  return Boolean(
    user?.permissions.manageAttendance,
  );
}
