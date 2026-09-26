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
  ceo: ["/", "/members", "/mam", "/remittances", "/programs", "/branches", "/cash-transactions", "/reports", "/settings"],
  president: ["/", "/members", "/mam", "/remittances", "/programs", "/branches", "/cash-transactions", "/reports", "/settings"],
  "hr officer": ["/", "/employees", "/branches", "/attendance", "/attendance-reviews", "/leave-requests", "/leave-approvals", "/settings"],
  hr: ["/", "/employees", "/branches", "/attendance", "/attendance-reviews", "/leave-requests", "/leave-approvals", "/settings"],
  finance: ["/", "/members", "/collections", "/remittances", "/mam", "/programs", "/expenses", "/cash-transactions", "/reports", "/settings"],
  "entry clerk": ["/", "/new-sales", "/members", "/collections", "/attendance", "/leave-requests", "/reports", "/settings"],
  "it clerk": ["/", "/employees", "/user-accounts", "/branches", "/settings"],
  it: ["/", "/employees", "/user-accounts", "/branches", "/settings"],
  mas: ["/", "/members", "/collections", "/remittances", "/mam", "/attendance", "/leave-requests", "/settings"],
};

function routeMatches(pathname: string, route: string) {
  return pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
}

export function accessibleRoutes(context: AccessContext) {
  const names = context.roleNames.map((role) => role.trim().toLowerCase()).filter(Boolean);
  if (names.some((role) => roleRoutes[role]?.includes("*"))) return ["*"];
  const routes = new Set(names.flatMap((role) => roleRoutes[role] ?? []));
  routes.add("/");
  if (context.permissions.manageUsers) ["/employees", "/user-accounts", "/programs", "/branches", "/settings"].forEach((route) => routes.add(route));
  if (context.permissions.manageAttendance) ["/attendance", "/attendance-reviews", "/leave-requests", "/leave-approvals"].forEach((route) => routes.add(route));
  if (context.permissions.viewAttendanceReports) routes.add("/attendance-reviews");
  return [...routes];
}

export function canAccessPath(context: AccessContext, pathname: string) {
  const routes = accessibleRoutes(context);
  return routes.includes("*") || routes.some((route) => routeMatches(pathname, route));
}
