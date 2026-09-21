"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileBarChart,
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
import { useState } from "react";

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
        name: "Programs",
        href: "/programs",
        icon: Database,
      },
      {
        name: "Promos",
        href: "/promos",
        icon: FileText,
      },
    ],
  },
  {
    title: "REPORTS",
    items: [
      {
        name: "Reports",
        href: "/reports",
        icon: FileBarChart,
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
  const [mobileOpen, setMobileOpen] = useState(false);

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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background transition-transform duration-200 md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-5">
          <div>
            <div className="text-lg font-bold tracking-tight">DAYONG</div>
            <div className="text-xs text-muted-foreground">
              Temporary System
            </div>
          </div>

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
            {navigation.map((section) => (
              <div key={section.title}>
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {section.title}
                </p>

                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;

                    const isActive =
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href);

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
            ))}
          </div>
        </nav>

        {/* Bottom */}
        <div className="border-t p-3">
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <LogOut className="size-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}