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
const roleRoutes: Record<string, string[]> = {
  administrator: ["*"],
  admin: ["*"],
  ceo: ["/", "/members", "/mam", "/remittances", "/programs", "/branches", "/cash-transactions", "/fidelity", "/reports", "/settings"],
  president: ["/", "/members", "/mam", "/remittances", "/programs", "/branches", "/cash-transactions", "/fidelity", "/reports", "/settings"],
  "hr officer": ["/", "/employees", "/branches", "/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals", "/settings"],
  hr: ["/", "/employees", "/branches", "/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals", "/settings"],
  finance: ["/", "/members", "/collections", "/remittances", "/mam", "/programs", "/expenses", "/cash-transactions", "/vendor-payables", "/commissions", "/fidelity", "/reports", "/history", "/attendance", "/attendance-tracking", "/leave-requests", "/settings"],
  "entry clerk": ["/", "/new-sales", "/members", "/collections", "/remittances", "/attendance", "/leave-requests", "/reports", "/settings"],
  "it clerk": ["/", "/employees", "/user-accounts", "/branches", "/settings"],
  it: ["/", "/employees", "/user-accounts", "/branches", "/settings"],
  mas: ["/", "/members", "/collections", "/remittances", "/mam", "/fidelity", "/attendance", "/leave-requests", "/master-data", "/settings"],
};

// Every signed-in employee's shared workspace, added to roles that still use default access.
const employeeRoutes = ["/programs", "/branches", "/master-data", "/members", "/mam", "/fidelity", "/attendance", "/leave-requests"];
// Always reachable so nobody is locked out of their dashboard or password change.
const alwaysAllowed = ["/", "/settings"];

export const normalizeRoleName = (role: string) => role.trim().toLowerCase();
export const isAdministratorRole = (role: string) => ["administrator", "admin"].includes(normalizeRoleName(role));

/** Pages a role receives when its page access has not been configured. Used to pre-fill the Roles editor. */
export function defaultRoutesForRole(role: string) {
  const routes = roleRoutes[normalizeRoleName(role)] ?? [];
  if (routes.includes("*")) return ["*"];
  return [...new Set([...alwaysAllowed, ...routes, ...employeeRoutes])];
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
