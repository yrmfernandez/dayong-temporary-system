"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3, Building2, CalendarCheck, ChevronLeft, ChevronRight,
  ClipboardList, CreditCard, Database, FileText, ChartNoAxesColumnIncreasing,
  LayoutDashboard, LogOut, Menu, Receipt, Settings, UserCheck, Users,
  Wallet, PiggyBank, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import type { AccessContext } from "@/lib/access-control";

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavSection = { title: string; items: NavItem[] };
type IndicatorStyle = "pill" | "line";

const navigation: NavSection[] = [
  { title: "MAIN", items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }] },
  { title: "OPERATIONS", items: [
    { name: "New Sales", href: "/new-sales", icon: FileText },
    { name: "Collections / Payments", href: "/collections", icon: Receipt },
    { name: "Remittances", href: "/remittances", icon: Wallet },
    { name: "MAM", href: "/mam", icon: BarChart3 },
  ] },
  { title: "FINANCE", items: [
    { name: "Expenses", href: "/expenses", icon: CreditCard },
    { name: "Cash Transactions", href: "/cash-transactions", icon: Wallet },
    { name: "Vendor Payables", href: "/vendor-payables", icon: Receipt },
    { name: "Commissions", href: "/commissions", icon: CreditCard },
    { name: "My Fidelity", href: "/fidelity", icon: PiggyBank },
  ] },
  { title: "MY HR", items: [
    { name: "Attendance", href: "/attendance", icon: CalendarCheck },
    { name: "Attendance Review", href: "/attendance-reviews", icon: ClipboardList },
    { name: "Attendance Tracking", href: "/attendance-tracking", icon: BarChart3 },
    { name: "Leave Requests", href: "/leave-requests", icon: FileText },
    { name: "Leave Approvals", href: "/leave-approvals", icon: CalendarCheck },
  ] },
  { title: "REPORTS", items: [
    { name: "Reports Dashboard", href: "/reports", icon: ChartNoAxesColumnIncreasing },
    { name: "Daily Report", href: "/reports/daily", icon: FileText },
    { name: "Weekly Report", href: "/reports/weekly", icon: FileText },
    { name: "Monthly Report", href: "/reports/monthly", icon: BarChart3 },
    { name: "Yearly Report", href: "/reports/yearly", icon: BarChart3 },
  ] },
  { title: "MASTER DATA", items: [
    { name: "Master Data", href: "/master-data", icon: Database },
    { name: "My Members", href: "/members", icon: Users },
    { name: "Employees", href: "/employees", icon: Users },
    { name: "User Accounts", href: "/user-accounts", icon: Users },
    { name: "Programs", href: "/programs", icon: Database },
    { name: "Branches", href: "/branches", icon: Building2 },
  ] },
  { title: "SYSTEM", items: [
    { name: "Settings", href: "/settings", icon: Settings },
    { name: "Roles", href: "/roles", icon: UserCheck },
    { name: "Audit Log", href: "/history", icon: ClipboardList },
    { name: "User Report Review", href: "/admin-reports", icon: ChartNoAxesColumnIncreasing },
  ] },
];

const baseEmployeePaths = ["/", "/members", "/fidelity", "/mam", "/attendance", "/leave-requests", "/master-data", "/programs", "/branches", "/settings"];
const reportPaths = ["/reports", "/reports/daily", "/reports/weekly", "/reports/monthly", "/reports/yearly"];
const rolePaths: Record<string, string[] | "all"> = {
  administrator: "all",
  admin: "all",
  "entry clerk": [...baseEmployeePaths, "/new-sales", "/collections", "/remittances", ...reportPaths],
  finance: ["/", "/mam", "/collections", "/remittances", "/cash-transactions", "/expenses", "/vendor-payables", "/commissions", "/reports", "/history", "/settings", "/attendance", "/attendance-tracking", "/leave-requests"],
  "hr officer": [...baseEmployeePaths, "/employees", "/attendance-reviews", "/attendance-tracking", "/leave-approvals"],
  hr: [...baseEmployeePaths, "/employees", "/attendance-reviews", "/attendance-tracking", "/leave-approvals"],
  ceo: [...baseEmployeePaths, "/remittances", "/cash-transactions", ...reportPaths],
  president: [...baseEmployeePaths, "/remittances", "/cash-transactions", ...reportPaths],
  "it clerk": [...baseEmployeePaths, "/employees", "/user-accounts", "/roles", "/history"],
  it: [...baseEmployeePaths, "/employees", "/user-accounts", "/roles", "/history"],
  mas: baseEmployeePaths,
};

const normalizeRole = (role: string) => role.trim().toLowerCase();
const routeMatches = (pathname: string, href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState<IndicatorStyle>("pill");
  const [activeRole, setActiveRole] = useState("");
  const [access, setAccess] = useState<AccessContext>({
    roleNames: [],
    permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false },
  });

  useEffect(() => {
    setCollapsed(localStorage.getItem("dayong-sidebar-collapsed") === "true");
    setIndicatorStyle(localStorage.getItem("dayong-sidebar-indicator") === "line" ? "line" : "pill");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) return;
        const roleNames = Array.isArray(result.user?.roleNames) ? result.user.roleNames.map(String) : [];
        setAccess({
          roleNames,
          permissions: {
            manageUsers: Boolean(result.user?.permissions?.manageUsers),
            manageAttendance: Boolean(result.user?.permissions?.manageAttendance),
            viewAttendanceReports: Boolean(result.user?.permissions?.viewAttendanceReports),
          },
        });
        const available = [...new Map([...roleNames, "MAS"].map((role: string) => [normalizeRole(role), role])).values()];
        const saved = localStorage.getItem("dayong-active-role") ?? "";
        setActiveRole(available.some((role: string) => normalizeRole(role) === normalizeRole(saved)) ? available.find((role: string) => normalizeRole(role) === normalizeRole(saved)) ?? available[0] ?? "MAS" : available[0] ?? "MAS");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", close); };
  }, [mobileOpen]);

  const allowedPaths = useMemo(() => {
    const configured = rolePaths[normalizeRole(activeRole)] ?? baseEmployeePaths;
    return configured === "all" ? null : new Set(configured);
  }, [activeRole]);

  const availableRoles = useMemo(() => [...new Map([...access.roleNames, "MAS"].map((role) => [normalizeRole(role), role])).values()], [access.roleNames]);

  const visibleNavigation = useMemo(() => navigation.map((section) => ({
    ...section,
    items: section.items.filter((item) => !allowedPaths || allowedPaths.has(item.href)),
  })).filter((section) => section.items.length), [allowedPaths]);

  function chooseRole(role: string) {
    setActiveRole(role);
    localStorage.setItem("dayong-active-role", role);
    const configured = rolePaths[normalizeRole(role)] ?? baseEmployeePaths;
    if (configured !== "all" && !configured.some((href) => routeMatches(pathname, href))) router.push("/");
    setMobileOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      localStorage.setItem("dayong-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  function changeIndicator(style: IndicatorStyle) {
    setIndicatorStyle(style);
    localStorage.setItem("dayong-sidebar-indicator", style);
  }

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("dayong-active-role");
    setMobileOpen(false);
    router.replace("/login");
    router.refresh();
  }

  return <>
    <button onClick={() => setMobileOpen(true)} className="fixed left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex min-h-11 items-center gap-2 rounded-xl border border-violet-90 bg-white/95 px-3 py-2 font-semibold text-violet-20 shadow-lg backdrop-blur md:hidden" aria-label="Open navigation">
      <Menu className="size-5" /><span className="text-sm">Menu</span>
    </button>
    {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}

    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] shrink-0 flex-col border-r border-violet-90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[8px_0_36px_-18px_rgb(45_28_89_/_0.35)] backdrop-blur-xl transition-[width,transform] duration-200 md:static md:h-dvh md:translate-x-0 ${collapsed ? "md:w-20" : "md:w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className={`flex h-20 items-center border-b border-white/10 bg-gradient-to-br from-violet-20 via-violet-30 to-purple-40 text-white ${collapsed ? "md:justify-center md:px-2" : "justify-between px-4"}`}>
        <Link href="/" className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMobileOpen(false)} aria-label="Dayong Monitoring System home">
          <BrandLogo className="size-11 shrink-0 rounded-full object-contain drop-shadow-sm" priority />
          <div className={`min-w-0 leading-tight ${collapsed ? "md:hidden" : ""}`}><div className="text-lg font-black tracking-tight">DAYONG</div><div className="truncate text-xs text-violet-90">Monitoring System</div></div>
        </Link>
        <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-white/10 md:hidden" aria-label="Close navigation"><X className="size-5" /></button>
      </div>

      <div className={`border-b bg-violet-95/40 p-3 ${collapsed ? "md:px-2" : ""}`}>
        <label className={`mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${collapsed ? "md:text-center" : ""}`}>{collapsed ? <span className="hidden md:inline">Role</span> : "Active role"}</label>
        <div className="flex gap-2">
          <select aria-label="Active role" title={activeRole || "Select active role"} className={`h-9 min-w-0 flex-1 rounded-lg border border-violet-90 bg-white text-sm text-violet-20 outline-none focus:ring-2 focus:ring-violet-60 ${collapsed ? "px-1 md:text-[0]" : "px-2"}`} value={activeRole} onChange={(event) => chooseRole(event.target.value)}>
            {availableRoles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <button type="button" onClick={toggleCollapsed} title={collapsed ? "Maximize sidebar" : "Minimize sidebar"} aria-label={collapsed ? "Maximize sidebar" : "Minimize sidebar"} className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-violet-90 bg-white text-violet-30 hover:bg-violet-95 md:flex">
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>
      </div>

      <nav className={`flex-1 overflow-y-auto bg-gradient-to-b from-white to-violet-95/40 py-4 ${collapsed ? "md:px-2" : "px-3"}`} aria-label={`${activeRole || "User"} navigation`}>
        <div className="space-y-6">
          {visibleNavigation.map((section) => <div key={section.title}>
            <p className={`mb-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground ${collapsed ? "md:hidden" : ""}`}>{section.title}</p>
            <div className="space-y-1">{section.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.href === "/" || item.href === "/reports" ? pathname === item.href : routeMatches(pathname, item.href);
              const activeClass = indicatorStyle === "pill" ? "bg-gradient-to-r from-violet-60 to-purple-50 text-white shadow-md shadow-violet-60/20" : "border-l-[3px] border-violet-60 bg-violet-95 text-violet-20";
              return <Link key={item.href} href={item.href} title={collapsed ? item.name : undefined} onClick={() => setMobileOpen(false)} className={`flex min-h-10 items-center gap-3 px-3 py-2 text-sm font-medium transition-colors ${indicatorStyle === "pill" ? "rounded-md" : "rounded-r-md"} ${collapsed ? "md:justify-center md:px-2" : ""} ${isActive ? activeClass : "text-violet-30 hover:bg-violet-95 hover:text-violet-10"}`}>
                <Icon className="size-4 shrink-0" /><span className={collapsed ? "md:hidden" : ""}>{item.name}</span>
              </Link>;
            })}</div>
          </div>)}
        </div>
      </nav>

      <div className={`space-y-2 border-t bg-white p-3 ${collapsed ? "md:px-2" : ""}`}>
        <div className={collapsed ? "md:hidden" : ""}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active indicator</p>
          <div className="grid grid-cols-2 rounded-lg bg-violet-95 p-1 text-xs">
            {(["pill", "line"] as const).map((style) => <button key={style} type="button" onClick={() => changeIndicator(style)} className={`rounded-md px-2 py-1.5 capitalize ${indicatorStyle === style ? "bg-white font-semibold text-violet-20 shadow-sm" : "text-muted-foreground"}`}>{style}</button>)}
          </div>
        </div>
        <button type="button" onClick={() => void handleSignOut()} title={collapsed ? "Sign Out" : undefined} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground ${collapsed ? "md:justify-center md:px-2" : ""}`}>
          <LogOut className="size-4" /><span className={collapsed ? "md:hidden" : ""}>Sign Out</span>
        </button>
      </div>
    </aside>
  </>;
}
