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
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
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
        className="fixed left-4 top-4 z-40 rounded-md border bg-background p-2 shadow-sm md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-white/85 shadow-[4px_0_24px_-12px_rgb(45_28_89_/_0.18)] backdrop-blur-xl transition-transform duration-200 md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-4">
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
              <div className="text-lg font-bold tracking-tight">DAYONG</div>
              <div className="truncate text-xs text-muted-foreground">
                Monitoring System
              </div>
            </div>
          </Link>

          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-2 hover:bg-muted md:hidden"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
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
                      item.href === "/"
                        ? pathname === "/"
                        : pathname === item.href ||
                          pathname.startsWith(`${item.href}/`);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
