import { cookies } from "next/headers";

import { canAccessPath, canManageAccountsFor, canManageConfigurationFor, canManageEmployeesFor } from "@/lib/access-control";
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

/**
 * The signed-in user when they may open at least one of these pages, else null. APIs use this so a page's data
 * follows the same access as the page itself (Roles → Page access, role defaults, and action permissions).
 */
export async function userWithPageAccess(...paths: string[]) {
  const user = await getSessionUser();
  return user && paths.some((path) => canAccessPath(user, path)) ? user : null;
}

export async function canManageAccounts() { const user = await getSessionUser(); return Boolean(user && canManageAccountsFor(user)); }
export async function canManageEmployees() { const user = await getSessionUser(); return Boolean(user && canManageEmployeesFor(user)); }
export async function canManageConfiguration() { const user = await getSessionUser(); return Boolean(user && canManageConfigurationFor(user)); }

export async function canManageUsers() {
  const user = await getSessionUser();
  const roles = user?.roleNames.map((role) => role.trim().toLowerCase()) ?? [];
  return Boolean(user?.permissions.manageUsers || roles.includes("administrator") || roles.includes("admin"));
}

export async function canManageAttendance() {
  const user = await getSessionUser();
  const roles = user?.roleNames.map((role) => role.trim().toLowerCase()) ?? [];
  // Administrators always manage attendance, matching how they always manage users.
  return Boolean(user?.permissions.manageAttendance || roles.includes("administrator") || roles.includes("admin"));
}
