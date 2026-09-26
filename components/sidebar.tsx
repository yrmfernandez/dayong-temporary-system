"use client";

import Link from "next/link";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  ChartNoAxesColumnIncreasing,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  UserCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { 
  useEffect, 
  useState 
} from "react";
import { BrandLogo } from "@/components/brand-logo";
import { canAccessPath, type AccessContext } from "@/lib/access-control";

const navigation = [
  {
    title: "MAIN",
    items: [
      {
        name: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "OPERATIONS",
    items: [
      {
        name: "New Sales",
        href: "/new-sales",
        icon: FileText,
      },
      {
        name: "Collections",
        href: "/collections",
        icon: Receipt,
      },
      {
        name: "Remittances",
        href: "/remittances",
        icon: Wallet,
      },
      {
        name: "MAM",
        href: "/mam",
        icon: BarChart3,
      },
      {
        name: "Attendance",
        href: "/attendance",
        icon: CalendarCheck,
      },
      {
        name: "Attendance Review",
        href: "/attendance-reviews",
        icon: ClipboardList,
      },
      {
        name: "Leave Requests",
        href: "/leave-requests",
        icon: FileText,
      },
      {
        name: "Leave Approvals",
        href: "/leave-approvals",
        icon: CalendarCheck,
      },
    ],
  },
  {
    title: "FINANCE",
    items: [
      {
        name: "Expenses",
        href: "/expenses",
        icon: CreditCard,
      },
      {
        name: "Cash Transactions",
        href: "/cash-transactions",
        icon: Wallet,
      },
    ],
  },
  {
    title: "REPORTS",
    items: [
      { name: "Reports Dashboard", href: "/reports", icon: ChartNoAxesColumnIncreasing },
      { name: "Daily Report", href: "/reports/daily", icon: FileText },
      { name: "Weekly Report", href: "/reports/weekly", icon: FileText },
      { name: "Monthly Report", href: "/reports/monthly", icon: BarChart3 },
      { name: "Yearly Report", href: "/reports/yearly", icon: BarChart3 },
    ],
  },
  {
    title: "MASTER DATA",
    items: [
      {
        name: "Members",
        href: "/members",
        icon: Users,
      },
      {
        name: "Employees",
        href: "/employees",
        icon: Users,
      },
      {
        name: "User Accounts",
        href: "/user-accounts",
        icon: Users,
      },
      {
        name: "Programs",
        href: "/programs",
        icon: Database,
      },
      {
        name: "Branches",
        href: "/branches",
        icon: Building2,
      },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      {
        name: "Settings",
        href: "/settings",
        icon: Settings,
      },
      { name: "Roles", href: "/roles", icon: UserCheck },
      { name: "Entry History", href: "/history", icon: ClipboardList },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [access, setAccess] = useState<AccessContext>({
    roleNames: [],
    permissions: {
      manageUsers: false,
      manageAttendance: false,
      viewAttendanceReports: false,
    },
  });

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch(
          "/api/auth/session",
          {
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (result.success) {
          setAccess({
            roleNames: Array.isArray(result.user?.roleNames)
              ? result.user.roleNames.map(String)
              : [],
            permissions: {
              manageUsers: Boolean(result.user?.permissions?.manageUsers),
              manageAttendance: Boolean(result.user?.permissions?.manageAttendance),
              viewAttendanceReports: Boolean(result.user?.permissions?.viewAttendanceReports),
            },
          });
        }
      } catch {
        setAccess({ roleNames: [], permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false } });
      }
    };

    void loadSession();
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", close); };
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
    });

    setMobileOpen(false);
    router.replace("/login");
    router.refresh();
  };

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex min-h-11 items-center gap-2 rounded-xl border border-violet-90 bg-white/95 px-3 py-2 font-semibold text-violet-20 shadow-lg backdrop-blur md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
        <span className="text-sm">Menu</span>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] shrink-0 flex-col border-r border-violet-90 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[8px_0_36px_-18px_rgb(45_28_89_/_0.35)] backdrop-blur-xl transition-transform duration-200 md:static md:h-dvh md:w-64 md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex h-20 items-center justify-between border-b border-white/10 bg-gradient-to-br from-violet-20 via-violet-30 to-purple-40 px-4 text-white">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setMobileOpen(false)}
            aria-label="Dayong Monitoring System home"
          >
            <BrandLogo
              className="size-11 shrink-0 rounded-full object-contain drop-shadow-sm"
              priority
            />

            <div className="min-w-0 leading-tight">
              <div className="text-lg font-black tracking-tight">DAYONG</div>
              <div className="truncate text-xs text-violet-90">
                Monitoring System
              </div>
            </div>
          </Link>

          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 hover:bg-white/10 md:hidden"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-violet-95/40 px-3 py-4">
          <div className="space-y-6">
            {navigation.map((section) => {
              const items = section.items.filter((item) => canAccessPath(access, item.href));
              if (!items.length) return null;
              return (
              <div key={section.title}>
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {section.title}
                </p>

                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;

                    const isActive =
                      item.href === "/" || item.href === "/reports"
                        ? pathname === item.href
                        : pathname === item.href ||
                          pathname.startsWith(`${item.href}/`);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-gradient-to-r from-violet-60 to-purple-50 text-white shadow-md shadow-violet-60/20"
                            : "text-violet-30 hover:bg-violet-95 hover:text-violet-10"
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );})}
          </div>
        </nav>

        {/* Bottom */}
        <div className="border-t p-3">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
