import {
  BarChart3, Building2, CalendarCheck, CalendarClock, ChartNoAxesColumnIncreasing, ClipboardCheck,
  ClipboardList, CreditCard, Database, FilePlus2, FileSearch, FileText, HandCoins, History,
  LayoutDashboard, Banknote, PiggyBank, Receipt, ShieldCheck, UserCog, Users, Wallet,
  type LucideIcon,
} from "lucide-react";

import { canAccessPath, isAdministratorRole, type AccessContext } from "@/lib/access-control";

export type NavItem = { name: string; href: string; icon: LucideIcon; children?: NavItem[] };
export type NavSection = { title: string; items: NavItem[] };

// Every page appears here once so labels and icons stay consistent across role workspaces.
const page = {
  dashboard: { name: "Dashboard", href: "/", icon: LayoutDashboard },
  newSales: { name: "New Sales", href: "/new-sales", icon: FilePlus2 },
  collections: { name: "Collections", href: "/collections", icon: Receipt },
  remittances: { name: "Remittances", href: "/remittances", icon: Wallet },
  mam: { name: "MAM", href: "/mam", icon: BarChart3 },
  expenses: { name: "Expenses", href: "/expenses", icon: CreditCard },
  cash: { name: "Cash Transactions", href: "/cash-transactions", icon: HandCoins },
  payables: { name: "Vendor Payables", href: "/vendor-payables", icon: FileText },
  commissions: { name: "Commissions", href: "/commissions", icon: CreditCard },
  payroll: { name: "Payroll", href: "/payroll", icon: Banknote },
  fidelity: { name: "Fidelity", href: "/fidelity", icon: PiggyBank },
  myFidelity: { name: "My Fidelity", href: "/fidelity/me", icon: PiggyBank },
  reports: {
    name: "Reports", href: "/reports", icon: ChartNoAxesColumnIncreasing, children: [
      { name: "Daily", href: "/reports/daily", icon: FileText },
      { name: "Weekly", href: "/reports/weekly", icon: FileText },
      { name: "Monthly", href: "/reports/monthly", icon: BarChart3 },
      { name: "Yearly", href: "/reports/yearly", icon: BarChart3 },
    ],
  },
  userReports: { name: "User Report Review", href: "/admin-reports", icon: FileSearch },
  dailyAudit: { name: "Daily Audit", href: "/audit", icon: ClipboardCheck },
  members: { name: "Members", href: "/members", icon: Users },
  myMembers: { name: "My Members", href: "/members", icon: Users },
  employees: { name: "Employees", href: "/employees", icon: Users },
  attendanceReview: { name: "Attendance Review", href: "/attendance-reviews", icon: ClipboardCheck },
  attendanceTracking: { name: "Attendance Tracking", href: "/attendance-tracking", icon: CalendarClock },
  leaveApprovals: { name: "Leave Approvals", href: "/leave-approvals", icon: CalendarCheck },
  attendance: { name: "My Attendance", href: "/attendance", icon: CalendarCheck },
  leaveRequests: { name: "Leave Requests", href: "/leave-requests", icon: ClipboardList },
  programs: { name: "Programs", href: "/programs", icon: Database },
  branches: { name: "Branches", href: "/branches", icon: Building2 },
  masterData: { name: "Master Data", href: "/master-data", icon: Database },
  userAccounts: { name: "User Accounts", href: "/user-accounts", icon: UserCog },
  roles: { name: "Roles", href: "/roles", icon: ShieldCheck },
  auditLog: { name: "Audit Log", href: "/history", icon: History },
} satisfies Record<string, NavItem>;

// Personal self-service. MAS lists My Fidelity under My Portfolio instead.
const myHr: NavSection = { title: "My HR", items: [page.attendance, page.leaveRequests, page.myFidelity] };
const masHr: NavSection = { title: "My HR", items: [page.attendance, page.leaveRequests] };

/**
 * Sidebar workspace per role. Sections follow each role's daily workflow:
 * the work they do most often first, oversight next, reference lookups and
 * personal self-service last. Settings and Sign Out live in the sidebar footer.
 */
const workspaces: Record<string, NavSection[]> = {
  administrator: [
    { title: "Overview", items: [page.dashboard] },
    { title: "Operations", items: [page.newSales, page.collections, page.remittances, page.mam] },
    { title: "Finance", items: [page.cash, page.expenses, page.payables, page.commissions, page.payroll, page.fidelity] },
    { title: "Reports", items: [page.reports, page.dailyAudit, page.userReports] },
    { title: "People", items: [page.employees, page.attendanceReview, page.attendanceTracking, page.leaveApprovals] },
    { title: "Master Data", items: [page.members, page.programs, page.branches] },
    { title: "Administration", items: [page.userAccounts, page.roles, page.auditLog] },
    myHr,
  ],
  executive: [
    { title: "Overview", items: [page.dashboard] },
    { title: "People", items: [page.attendanceTracking] },
    { title: "My HR", items: [page.attendance] },
  ],
  finance: [
    { title: "Overview", items: [page.dashboard] },
    { title: "Cash", items: [page.remittances, page.collections, page.cash] },
    { title: "Payables", items: [page.payroll, page.commissions, page.expenses, page.payables] },
    { title: "Monitoring", items: [page.mam, page.fidelity, page.reports, page.dailyAudit, page.auditLog] },
    { title: "Directory", items: [page.members, page.programs] },
    { title: "My HR", items: [page.attendance, page.attendanceTracking, page.leaveRequests, page.myFidelity] },
  ],
  "entry clerk": [
    { title: "Overview", items: [page.dashboard] },
    { title: "Encoding", items: [page.newSales, page.collections, page.remittances] },
    { title: "Reports", items: [page.reports] },
    { title: "Lookup", items: [page.members, page.programs, page.branches] },
    myHr,
  ],
  hr: [
    { title: "Overview", items: [page.dashboard] },
    { title: "People", items: [page.employees, page.attendanceReview, page.attendanceTracking, page.leaveApprovals] },
    { title: "Audit", items: [page.dailyAudit] },
    { title: "Directory", items: [page.branches] },
    myHr,
  ],
  it: [
    { title: "Overview", items: [page.dashboard] },
    { title: "Access", items: [page.userAccounts, page.employees, page.roles] },
    { title: "Configuration", items: [page.branches, page.programs, page.auditLog] },
    myHr,
  ],
  mas: [
    { title: "Overview", items: [page.dashboard] },
    { title: "My Portfolio", items: [page.myMembers, page.mam, page.myFidelity] },
    { title: "Reference", items: [page.programs, page.branches, page.masterData] },
    masHr,
  ],
};

const roleAliases: Record<string, string> = {
  administrator: "administrator", admin: "administrator",
  ceo: "executive", president: "executive",
  finance: "finance",
  "entry clerk": "entry clerk",
  "hr officer": "hr", hr: "hr",
  "it clerk": "it", it: "it",
  mas: "mas",
};

export const normalizeRole = (role: string) => role.trim().toLowerCase();

export function workspaceFor(role: string) {
  return workspaces[roleAliases[normalizeRole(role)] ?? "mas"];
}

export const routeMatches = (pathname: string, href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

// Reversed so the first (generic) label wins where two entries share a route, e.g. Members / My Members.
const pagesByHref = new Map<string, NavItem>(Object.values(page).reverse().map((item) => [item.href, item]));

/**
 * The active role's workspace, minus any page the server would refuse for this session.
 * When an administrator configured the role's page access, only those pages show, and granted
 * pages outside the role's usual workspace are listed under "More".
 */
export function visibleNavigation(role: string, access: AccessContext): NavSection[] {
  const configured = isAdministratorRole(role) ? undefined : access.rolePages?.[normalizeRole(role)];
  const inRole = (href: string) => !configured || href === "/" || configured.some((route) => routeMatches(href, route));
  const allowed = (item: NavItem) => canAccessPath(access, item.href) && inRole(item.href);
  const sections = workspaceFor(role)
    .map((section) => ({
      ...section,
      items: section.items.filter(allowed).map((item) => item.children ? { ...item, children: item.children.filter(allowed) } : item),
    }))
    .filter((section) => section.items.length);
  if (!configured) return sections;
  const shown = new Set(sections.flatMap((section) => section.items.map((item) => item.href)));
  const extra = configured.filter((href) => !shown.has(href) && href !== "/settings").map((href) => pagesByHref.get(href)).filter((item): item is NavItem => Boolean(item) && allowed(item!));
  return extra.length ? [...sections, { title: "More", items: extra }] : sections;
}

export function isInWorkspace(role: string, pathname: string, access?: AccessContext) {
  if (pathname === "/settings") return true;
  const sections = access ? visibleNavigation(role, access) : workspaceFor(role);
  return sections.some((section) => section.items.some((item) => routeMatches(pathname, item.href)));
}

/** Section and page labels for the top bar breadcrumb. */
export function locatePage(pathname: string, sections: NavSection[]) {
  if (pathname === "/settings") return { section: "Account", title: "Settings" };
  const active = activeHref(pathname, sections);
  for (const section of sections) {
    for (const item of section.items) {
      const child = item.children?.find((entry) => entry.href === active);
      if (child) return { section: item.name, title: `${child.name} Report` };
      if (item.href === active) return { section: section.title, title: item.name };
    }
  }
  return { section: "Dayong", title: "Workspace" };
}

/** The most specific nav href for this path, so /fidelity/me highlights My Fidelity, not Fidelity. */
export function activeHref(pathname: string, sections: NavSection[]) {
  const hrefs = sections.flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]));
  return hrefs
    .filter((href) => href === "/" ? pathname === "/" : routeMatches(pathname, href))
    .sort((a, b) => b.length - a.length)[0] ?? "";
}
