"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";

import type { ShellUser } from "@/components/app-shell";
import { initials } from "@/components/sidebar";
import { locatePage, type NavSection } from "@/lib/navigation";

type TopbarProps = { sections: NavSection[]; activeRole: string; user: ShellUser | null; onMenu: () => void };

export function Topbar({ sections, activeRole, user, onMenu }: TopbarProps) {
  const pathname = usePathname();
  const location = locatePage(pathname, sections);
  const today = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());

  return (
    <header className="app-topbar glass-bar sticky top-0 z-30 px-3 pt-[env(safe-area-inset-top)] sm:px-4 md:px-6">
      <div className="mx-auto flex h-14 max-w-[1920px] items-center gap-3">
        <button type="button" onClick={onMenu} className="-ml-1 flex size-10 items-center justify-center rounded-xl text-violet-20 hover:bg-white/70 md:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="hidden shrink-0 text-violet-30/80 sm:block">{location.section}</li>
            <li className="hidden shrink-0 text-violet-80 sm:block" aria-hidden><ChevronRight className="size-3.5" /></li>
            <li className="truncate font-semibold text-violet-10" aria-current="page">{location.title}</li>
          </ol>
        </nav>
        <span className="hidden text-xs text-violet-30/80 lg:block" suppressHydrationWarning>{today}</span>
        {activeRole && <span className="hidden rounded-full border border-white/80 bg-white/60 px-2.5 py-1 text-xs font-semibold text-violet-30 shadow-sm sm:block">{activeRole}</span>}
        {user && <Link href="/settings" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-60 to-purple-50 text-xs font-bold uppercase text-white shadow-md shadow-violet-60/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-label={`Account settings for ${user.name}`}>
          {initials(user.name)}
        </Link>}
      </div>
    </header>
  );
}
