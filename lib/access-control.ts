export type AccessContext = {
  roleNames: string[];
  permissions: {
    manageUsers: boolean;
    manageAttendance: boolean;
    viewAttendanceReports: boolean;
  };
};

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

function routeMatches(pathname: string, route: string) {
  return pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
}

export function accessibleRoutes(context: AccessContext) {
  const names = context.roleNames.map((role) => role.trim().toLowerCase()).filter(Boolean);
  if (names.some((role) => roleRoutes[role]?.includes("*"))) return ["*"];
  const routes = new Set(names.flatMap((role) => roleRoutes[role] ?? []));
  routes.add("/");
  if (names.length) {
    routes.add("/programs");
    routes.add("/branches");
    routes.add("/master-data");
    routes.add("/members");
    routes.add("/mam");
    routes.add("/fidelity");
    routes.add("/attendance");
    routes.add("/leave-requests");
    routes.add("/settings");
  }
  if (context.permissions.manageUsers) ["/employees", "/user-accounts", "/programs", "/branches", "/settings"].forEach((route) => routes.add(route));
  if (context.permissions.manageAttendance) ["/attendance", "/attendance-reviews", "/attendance-tracking", "/leave-requests", "/leave-approvals"].forEach((route) => routes.add(route));
  if (context.permissions.viewAttendanceReports) ["/attendance-reviews", "/attendance-tracking"].forEach((route) => routes.add(route));
  return [...routes];
}

export function canAccessPath(context: AccessContext, pathname: string) {
  const routes = accessibleRoutes(context);
  return routes.includes("*") || routes.some((route) => routeMatches(pathname, route));
}
