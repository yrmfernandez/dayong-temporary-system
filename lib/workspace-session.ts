import { executiveRoles, normalizeRoleName, type AccessContext } from "@/lib/access-control";

/**
 * The session as the chosen sidebar workspace sees it (owner, October 30, 2026): an Administrator who also holds Entry
 * Clerk and opens the Entry Clerk workspace sees Reports, Remittances and every other page exactly as an Entry Clerk
 * does, and the MAS workspace that every employee has (the "virtual MAS") behaves as a MAS: only their own members.
 *
 * It can only narrow: the roles become the one workspace role (a role the user holds, or MAS), with that role's own
 * permissions and page access, and `realAccess` keeps the real roles so a page is reachable only when both allow it
 * (canAccessPath). A workspace the user does not hold, or no workspace, leaves the session as it is.
 * The server applies it to every request (lib/auth-server.ts, proxy.ts) and the sidebar to its pages (app-shell). The
 * real session stays in the cookie: never issue a token from this view (createSessionToken refuses it).
 */
type Permissions = AccessContext["permissions"];
type Narrowable = AccessContext & { roles?: string[]; rolePermissions?: Record<string, Permissions> };

const NO_PERMISSIONS: Permissions = { manageUsers: false, manageAttendance: false, viewAttendanceReports: false };

export function sessionForWorkspace<T extends Narrowable>(session: T, workspace: string | undefined): T & { realAccess?: AccessContext } {
  let name = "";
  try { name = normalizeRoleName(decodeURIComponent(workspace ?? "")); } catch { return session; }
  if (!name) return session;
  const realAccess: AccessContext = { roleNames: session.roleNames, permissions: session.permissions, rolePages: session.rolePages };
  const held = session.roleNames.findIndex((role) => normalizeRoleName(role) === name);
  if (held >= 0) {
    if (session.roleNames.length === 1) return session;
    const pages = session.rolePages?.[name];
    return {
      ...session, roleNames: [session.roleNames[held]], ...(session.roles ? { roles: session.roles[held] ? [session.roles[held]] : [] } : {}),
      // Sessions issued before per-role permissions keep the combined ones until their next recheck (5 minutes).
      permissions: session.rolePermissions?.[name] ?? session.permissions,
      rolePages: pages ? { [name]: pages } : {},
      realAccess,
    };
  }
  // The MAS workspace every employee has, except users whose only roles are executive (components/app-shell.tsx).
  const executiveOnly = session.roleNames.length > 0 && session.roleNames.every((role) => executiveRoles.includes(normalizeRoleName(role)));
  if (name === "mas" && !executiveOnly) return { ...session, roleNames: ["MAS"], ...(session.roles ? { roles: [] } : {}), permissions: NO_PERMISSIONS, rolePages: {}, realAccess };
  return session;
}
