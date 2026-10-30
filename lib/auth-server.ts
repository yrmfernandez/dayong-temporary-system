import { cookies } from "next/headers";

import { canAccessPath, canManageAccountsFor, canManageConfigurationFor, canManageEmployeesFor, type AccessContext } from "@/lib/access-control";
import { ACTIVE_ROLE_COOKIE } from "@/lib/ui-preferences";
import { sessionForWorkspace } from "@/lib/workspace-session";
import {
  SESSION_COOKIE,
  type SessionUser,
  verifySessionToken,
} from "@/lib/auth";

/**
 * The signed-in user as the workspace chosen in the sidebar sees it (lib/workspace-session.ts): every page and API
 * follows that role. Use getRealSessionUser for the account itself (its role list, issuing a new token).
 */
export async function getSessionUser(): Promise<(SessionUser & { realAccess?: AccessContext }) | null> {
  const session = await getRealSessionUser();
  return session && sessionForWorkspace(session, (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value);
}

/** The signed-in user with all their roles, whatever workspace is open. */
export async function getRealSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
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
