import { createHash } from "node:crypto";

import type { SessionUser } from "@/lib/auth";
import { getLoginUserByEmployeeId, type LoginUserData } from "@/lib/google-sheets-data";

/** How often a session is confirmed against the Users and Roles sheets. */
export const SESSION_RECHECK_MS = 5 * 60 * 1000;

/** Short fingerprint of a password hash: it changes whenever the password does, and reveals nothing about it. */
export const passwordStamp = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);

export function sessionFor(user: LoginUserData, mustChangePassword: boolean): SessionUser {
  return {
    userId: user.id,
    employeeId: user.employeeId,
    name: user.fullName || user.employeeId,
    roles: user.roles.map((role) => role.id),
    roleNames: user.roles.map((role) => role.name),
    permissions: {
      manageUsers: user.roles.some((role) => role.manageUsers),
      manageAttendance: user.roles.some((role) => role.manageAttendance),
      viewAttendanceReports: user.roles.some((role) => role.viewAttendanceReports),
    },
    // Only roles with configured page access are listed; the rest use their default pages.
    rolePages: Object.fromEntries(
      user.roles
        .filter((role) => role.pages)
        .map((role) => [role.name.trim().toLowerCase(), role.pages as string[]]),
    ),
    mustChangePassword,
    passwordStamp: passwordStamp(user.passwordHash),
    checkedAt: Date.now(),
  };
}

/**
 * The session re-read from the sheets, with current roles and page access. Null when the account was deactivated or
 * removed, or its password was changed or reset since this session signed in.
 */
export async function recheckSession(session: SessionUser): Promise<SessionUser | null> {
  const user = await getLoginUserByEmployeeId(session.employeeId);
  if (!user || !session.passwordStamp || passwordStamp(user.passwordHash) !== session.passwordStamp) return null;
  return { ...sessionFor(user, session.mustChangePassword), expiresAt: session.expiresAt };
}
