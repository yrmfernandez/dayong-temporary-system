export type AccessContext = {
  roleNames: string[];
  permissions: {
    manageUsers: boolean;
    manageAttendance: boolean;
    viewAttendanceReports: boolean;
  };
  /** Pages configured in Roles → Page access, keyed by lowercase role name. Absent means the role uses its defaults. */
  rolePages?: Record<string, string[]>;
};

// Default page access for roles whose page access has not been configured in the Roles sheet.
// New Sales, Collections and Reports are the Entry Clerk's daily operations, so no other role receives them by default.
const roleRoutes: Record<string, string[]> = {
  administrator: ["*"],
  admin: ["*"],
  // The executive workspace is the analytics dashboard, User Report Review, MAM, Statements of Account, Members, and attendance; it does not receive the shared employee pages.
  ceo: ["/", "/admin-reports", "/mam", "/soa", "/members", "/attendance-tracking", "/attendance", "/settings"],
  president: ["/", "/admin-reports", "/mam", "/soa", "/members", "/attendance-tracking", "/attendance", "/settings"],
  "hr officer": ["/", "/todays-entries", "/audit", "/employees", "/branches", "/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals", "/settings"],
  hr: ["/", "/todays-entries", "/audit", "/employees", "/branches", "/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals", "/settings"],
  finance: ["/", "/audit", "/members", "/remittances", "/mam", "/programs", "/expenses", "/cash-transactions", "/vendor-payables", "/commissions", "/payroll", "/fidelity", "/history", "/attendance", "/attendance-tracking", "/leave-requests", "/settings"],
  "entry clerk": ["/", "/todays-entries", "/new-sales", "/members", "/collections", "/remittances", "/attendance", "/leave-requests", "/reports", "/settings"],
  // IT builds and runs the system: accounts, roles, configuration, and the audit trail.
  "it clerk": ["/", "/user-accounts", "/roles", "/employees", "/branches", "/programs", "/master-data", "/history", "/settings"],
  it: ["/", "/user-accounts", "/roles", "/employees", "/branches", "/programs", "/master-data", "/history", "/settings"],
  mas: ["/", "/members", "/remittances", "/mam", "/fidelity", "/attendance", "/leave-requests", "/master-data", "/settings"],
};

// Every signed-in employee's shared workspace, added to roles that still use default access.
const employeeRoutes = ["/programs", "/branches", "/master-data", "/members", "/mam", "/fidelity", "/attendance", "/leave-requests"];
export const executiveRoles = ["ceo", "president"];
// Always reachable so nobody is locked out of their dashboard or password change.
const alwaysAllowed = ["/", "/settings"];

export const normalizeRoleName = (role: string) => role.trim().toLowerCase();
export const isAdministratorRole = (role: string) => ["administrator", "admin"].includes(normalizeRoleName(role));
export const itRoles = ["it clerk", "it"];
export const hrRoles = ["hr officer", "hr"];
const hasRole = (context: Pick<AccessContext, "roleNames">, names: string[]) => context.roleNames.some((role) => names.includes(normalizeRoleName(role)) || isAdministratorRole(role));

/**
 * Job-specific management rights. `manage_users` still grants all of them, but it also approves remittances and voids
 * finance records, so IT and HR receive only the part of it their work needs.
 */
// Sign-in accounts, roles and the audit trail: IT's job.
export const canManageAccountsFor = (context: AccessContext) => context.permissions.manageUsers || hasRole(context, itRoles);
// The employee register: HR hires, IT sets up access.
export const canManageEmployeesFor = (context: AccessContext) => context.permissions.manageUsers || hasRole(context, [...itRoles, ...hrRoles]);
// Branches, programs and incentive tiers: system configuration kept by IT.
export const canManageConfigurationFor = (context: AccessContext) => context.permissions.manageUsers || hasRole(context, itRoles);

/** Pages a role receives when its page access has not been configured. Used to pre-fill the Roles editor. */
export function defaultRoutesForRole(role: string) {
  const name = normalizeRoleName(role), routes = roleRoutes[name] ?? [];
  if (routes.includes("*")) return ["*"];
  return [...new Set([...alwaysAllowed, ...routes, ...(executiveRoles.includes(name) ? [] : employeeRoutes)])];
}

function routeMatches(pathname: string, route: string) {
  return pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
}

export function routesForRole(role: string, context: Pick<AccessContext, "rolePages">) {
  const name = normalizeRoleName(role);
  // Administrators always keep every page so access can never be configured away from them.
  if (isAdministratorRole(name)) return ["*"];
  const configured = context.rolePages?.[name];
  return configured ? [...new Set([...alwaysAllowed, ...configured])] : defaultRoutesForRole(name);
}

export function accessibleRoutes(context: AccessContext) {
  const names = context.roleNames.map(normalizeRoleName).filter(Boolean);
  const perRole = names.map((role) => routesForRole(role, context));
  if (perRole.some((routes) => routes.includes("*"))) return ["*"];
  const routes = new Set([...alwaysAllowed, ...perRole.flat()]);
  // Action permissions need their pages; these match the APIs that accept each permission.
  if (context.permissions.manageUsers) ["/employees", "/user-accounts", "/roles", "/history", "/programs", "/branches"].forEach((route) => routes.add(route));
  if (context.permissions.manageAttendance) ["/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals"].forEach((route) => routes.add(route));
  if (context.permissions.viewAttendanceReports) ["/attendance-reviews", "/attendance-tracking"].forEach((route) => routes.add(route));
  return [...routes];
}

export function canAccessPath(context: AccessContext, pathname: string) {
  const routes = accessibleRoutes(context);
  return routes.includes("*") || routes.some((route) => routeMatches(pathname, route));
}

export type DashboardKind = "admin" | "executive" | "hr" | "finance" | "entry" | "it" | "mas" | "collector";

function kindOfRole(role: string): DashboardKind | null {
  const name = normalizeRoleName(role);
  if (isAdministratorRole(name)) return "admin";
  if (executiveRoles.includes(name)) return "executive";
  if (name === "finance") return "finance";
  if (hrRoles.includes(name)) return "hr";
  if (itRoles.includes(name)) return "it";
  if (name === "entry clerk") return "entry";
  if (name === "collector") return "collector";
  if (name === "mas") return "mas";
  return null;
}

/**
 * The dashboard for the workspace the user chose in the sidebar, when they really hold that role; otherwise their most
 * senior role. Every employee may also use the MAS workspace, except users whose only roles are executive.
 */
export function dashboardKind(user: Pick<AccessContext, "roleNames">, preferredRole = ""): DashboardKind {
  const roles = user.roleNames.map(normalizeRoleName);
  const preferred = normalizeRoleName(preferredRole);
  const executiveOnly = roles.length > 0 && roles.every((role) => executiveRoles.includes(role));
  if (preferred && (roles.includes(preferred) || (preferred === "mas" && !executiveOnly))) {
    const kind = kindOfRole(preferred);
    if (kind) return kind;
  }
  const order: DashboardKind[] = ["admin", "executive", "finance", "hr", "it", "entry", "collector", "mas"];
  const held = roles.map(kindOfRole).filter((kind): kind is DashboardKind => Boolean(kind));
  return order.find((kind) => held.includes(kind)) ?? "mas";
}
