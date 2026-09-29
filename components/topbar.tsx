"use client";

import { usePathname } from "next/navigation";
import { CalendarDays, ChevronRight, Menu } from "lucide-react";

import type { ShellUser } from "@/components/app-shell";
import { Avatar, ProfileMenu } from "@/components/profile";
import { ThemeToggle } from "@/components/theme-toggle";
import { locatePage, type NavSection } from "@/lib/navigation";

type TopbarProps = { sections: NavSection[]; activeRole: string; user: ShellUser | null; onMenu: () => void };

export function Topbar({ sections, activeRole, user, onMenu }: TopbarProps) {
  const pathname = usePathname();
  const location = locatePage(pathname, sections);
  const today = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());

  return (
    // The sticky wrapper is transparent; the rounded glass bar floats inside the page margins.
    <header className="app-topbar sticky top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4 md:px-6 md:pt-3">
      <div className="glass-bar mx-auto flex h-14 max-w-[1920px] items-center gap-3 px-3 sm:px-4">
        <button type="button" onClick={onMenu} className="-ml-1 flex size-10 items-center justify-center rounded-xl text-foreground hover:bg-muted md:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="hidden shrink-0 text-muted-foreground sm:block">{location.section}</li>
            <li className="hidden shrink-0 text-muted-foreground/60 sm:block" aria-hidden><ChevronRight className="size-3.5" /></li>
            <li className="truncate font-semibold text-foreground" aria-current="page">{location.title}</li>
          </ol>
        </nav>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex" suppressHydrationWarning><CalendarDays className="size-3.5 text-brand-gold" />{today}</span>
        {activeRole && <span className="tone-chip tone-brand hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:block">{activeRole}</span>}
        {/* The sidebar holds the labelled switch; phones get this compact one since the drawer is closed. */}
        <ThemeToggle className="md:hidden" />
        {user && <ProfileMenu name={user.name} employeeId={user.employeeId} activeRole={activeRole} side="bottom" triggerClassName="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
          <Avatar name={user.name} />
        </ProfileMenu>}
      </div>
    </header>
  );
}
