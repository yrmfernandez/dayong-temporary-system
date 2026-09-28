"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ShellUser } from "@/components/app-shell";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { routeMatches, type NavItem, type NavSection } from "@/lib/navigation";
import { onPreferencesChange, preferenceKeys, readIndicator, readPreference, removePreference, writePreference, type IndicatorStyle } from "@/lib/ui-preferences";

type SidebarProps = {
  sections: NavSection[];
  roles: string[];
  activeRole: string;
  onRoleChange: (role: string) => void;
  user: ShellUser | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({ sections, roles, activeRole, onRoleChange, user, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [indicator, setIndicator] = useState<IndicatorStyle>("pill");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const sync = () => { setCollapsed(readPreference(preferenceKeys.collapsed) === "true"); setIndicator(readIndicator()); };
    sync();
    return onPreferencesChange(sync);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onMobileClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen, onMobileClose]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sections;
    const hit = (item: NavItem) => item.name.toLowerCase().includes(term);
    return sections
      .map((section) => ({ ...section, items: section.items.filter((item) => hit(item) || item.children?.some(hit) || section.title.toLowerCase().includes(term)) }))
      .filter((section) => section.items.length);
  }, [sections, query]);

  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  // On phones the drawer is always expanded; "collapsed" only narrows the desktop rail.
  const rail = collapsed ? "md:hidden" : "";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    removePreference(preferenceKeys.activeRole);
    onMobileClose();
    router.replace("/login");
    router.refresh();
  }

  return <>
    {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" onClick={onMobileClose} aria-hidden />}

    <aside
      aria-label="Main navigation"
      className={`glass-sidebar fixed inset-y-2 left-2 z-50 flex w-[min(18rem,86vw)] shrink-0 flex-col overflow-hidden rounded-2xl transition-[width,transform] duration-200 md:static md:m-3 md:mr-0 md:h-[calc(100dvh-1.5rem)] md:translate-x-0 ${collapsed ? "md:w-[4.5rem]" : "md:w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]"}`}
    >
      <div className={`flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border ${collapsed ? "md:justify-center md:px-2" : "px-4"}`}>
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:flex-none" aria-label="Dayong Monitoring System home">
          <BrandLogo className="size-10 shrink-0 rounded-full bg-white object-contain p-0.5 shadow-md ring-2 ring-brand-lime/60" priority />
          <div className={`min-w-0 leading-tight ${rail}`}><div className="text-base font-black tracking-tight text-white">DAYONG</div><div className="truncate text-[11px] font-medium text-brand-lime">Monitoring System</div></div>
        </Link>
        <button type="button" onClick={onMobileClose} className="rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-white md:hidden" aria-label="Close navigation"><X className="size-5" /></button>
      </div>

      <div className={`shrink-0 space-y-2 px-3 pt-3 ${collapsed ? "md:px-2" : ""}`}>
        {roles.length > 1 && <label className="block">
          <span className={`mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted ${rail}`}>Workspace</span>
          <select aria-label="Active role workspace" title={activeRole} value={activeRole} onChange={(event) => onRoleChange(event.target.value)}
            className={`h-9 w-full rounded-lg border border-sidebar-border bg-sidebar-accent text-sm font-medium text-sidebar-foreground outline-none focus:ring-2 focus:ring-sidebar-ring [&>option]:bg-popover [&>option]:text-popover-foreground ${collapsed ? "px-2 md:px-0 md:text-[0px]" : "px-2"}`}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>}
        {itemCount > 8 && <div className={`relative ${rail}`}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-sidebar-muted" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a page" aria-label="Find a page"
            className="h-9 w-full rounded-lg border border-sidebar-border bg-sidebar-accent pl-8 pr-2 text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted focus:ring-2 focus:ring-sidebar-ring" />
        </div>}
      </div>

      <nav className={`flex-1 overflow-y-auto overscroll-contain py-3 [scrollbar-color:rgb(255_255_255/15%)_transparent] ${collapsed ? "md:px-2" : "px-3"}`} aria-label={`${activeRole || "User"} workspace`}>
        {!sections.length && <div className="space-y-2 px-1" aria-hidden>{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded-lg bg-sidebar-accent" />)}</div>}
        {!!sections.length && !filtered.length && <p className="px-3 py-6 text-center text-xs text-sidebar-muted">No page matches &ldquo;{query}&rdquo;.</p>}
        <div className="space-y-5">
          {filtered.map((section) => <div key={section.title}>
            <p className={`mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted ${rail}`}>{section.title}</p>
            {collapsed && <div className="mx-auto mb-2 hidden h-px w-6 bg-sidebar-border md:block" />}
            <div className="space-y-0.5">{section.items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} indicator={indicator} forceOpen={!!query} />)}</div>
          </div>)}
        </div>
      </nav>

      <div className={`shrink-0 space-y-2 border-t border-sidebar-border p-2.5 ${collapsed ? "md:px-2" : ""}`}>
        <div className={rail}><ThemeToggle className="flex w-full border-sidebar-border bg-sidebar-accent [&_button]:flex-1 [&_button]:justify-center [&_[aria-checked=false]]:text-sidebar-muted [&_[aria-checked=false]:hover]:text-white" showLabels /></div>
        <div className={`flex items-center gap-2 rounded-xl bg-sidebar-accent p-1.5 ${collapsed ? "md:flex-col md:bg-transparent md:p-0" : ""}`}>
          {user && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-lime to-brand-moss text-xs font-bold uppercase text-[#14101a]" title={`${user.name} · ${activeRole}`} aria-hidden>{initials(user.name)}</span>}
          <span className={`min-w-0 flex-1 leading-tight ${rail}`}>{user && <><span className="block truncate text-sm font-semibold text-white">{user.name}</span><span className="block truncate text-[11px] text-sidebar-muted">{activeRole}{user.employeeId ? ` · ${user.employeeId}` : ""}</span></>}</span>
          <IconAction label="Settings" href="/settings" active={pathname === "/settings"}><Settings className="size-4" /></IconAction>
          <IconAction label="Sign out" onClick={() => void signOut()} danger><LogOut className="size-4" /></IconAction>
        </div>
        <button type="button" onClick={() => writePreference(preferenceKeys.collapsed, String(!collapsed))} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`hidden min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-sidebar-muted hover:bg-sidebar-accent hover:text-white md:flex ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}<span className={rail}>Collapse sidebar</span>
        </button>
      </div>
    </aside>
  </>;
}

function NavLink({ item, pathname, collapsed, indicator, forceOpen }: { item: NavItem; pathname: string; collapsed: boolean; indicator: IndicatorStyle; forceOpen: boolean }) {
  const Icon = item.icon;
  const inside = item.href === "/" ? pathname === "/" : routeMatches(pathname, item.href);
  const [expanded, setExpanded] = useState(inside);
  const open = !!item.children?.length && (expanded || inside || forceOpen);
  const exact = item.children ? pathname === item.href : inside;
  const style = linkStyle(exact, indicator);

  return <div>
    <div className="relative flex items-center">
      <Link href={item.href} title={collapsed ? item.name : undefined} aria-current={exact ? "page" : undefined}
        className={`flex min-h-9 flex-1 items-center gap-3 px-3 py-1.5 text-sm font-medium transition-colors ${style} ${collapsed ? "md:justify-center md:px-0" : ""} ${!exact && inside ? "text-white" : ""}`}>
        <Icon className="size-4 shrink-0" /><span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{item.name}</span>
      </Link>
      {!!item.children?.length && <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${item.name} pages`}
        className={`absolute right-1 rounded-md p-1 ${exact && indicator === "pill" ? "text-sidebar-primary-foreground/80 hover:bg-black/10" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-white"} ${collapsed ? "md:hidden" : ""}`}>
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>}
    </div>
    {open && <div className={`ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2 ${collapsed ? "md:hidden" : ""}`}>
      {item.children!.map((child) => <Link key={child.href} href={child.href} aria-current={pathname === child.href ? "page" : undefined}
        className={`flex min-h-8 items-center rounded-md px-3 text-[13px] transition-colors ${pathname === child.href ? "bg-sidebar-accent font-semibold text-brand-lime" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-white"}`}>{child.name}</Link>)}
    </div>}
  </div>;
}

function IconAction({ label, href, onClick, active = false, danger = false, children }: { label: string; href?: string; onClick?: () => void; active?: boolean; danger?: boolean; children: React.ReactNode }) {
  const className = `flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${active ? "bg-sidebar-primary text-sidebar-primary-foreground" : `text-sidebar-muted hover:bg-sidebar-accent ${danger ? "hover:text-brand-red" : "hover:text-white"}`}`;
  return href
    ? <Link href={href} title={label} aria-label={label} aria-current={active ? "page" : undefined} className={className}>{children}</Link>
    : <button type="button" onClick={onClick} title={label} aria-label={label} className={className}>{children}</button>;
}

// Lime on aubergine mirrors the seal's ring and lettering.
function linkStyle(active: boolean, indicator: IndicatorStyle) {
  if (!active) return "rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white";
  return indicator === "pill"
    ? "rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-md shadow-black/20"
    : "rounded-r-lg border-l-[3px] border-sidebar-primary bg-sidebar-accent text-white";
}

export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)) || "?";
}
