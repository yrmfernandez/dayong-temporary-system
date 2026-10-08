"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { executiveRoles, type AccessContext } from "@/lib/access-control";
import { normalizeRole, visibleNavigation } from "@/lib/navigation";
import { ACTIVE_ROLE_COOKIE, onPreferencesChange, preferenceKeys, readDensity, readPreference, writeActiveRoleCookie, writePreference } from "@/lib/ui-preferences";

const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export type ShellUser = { name: string; employeeId: string };

const emptyAccess: AccessContext = { roleNames: [], permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false } };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ShellUser | null>(null);
  const [access, setAccess] = useState<AccessContext>(emptyAccess);
  const [activeRole, setActiveRole] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  // True while the dashboard of a newly chosen workspace is loading, so the old one is not mistaken for it.
  const [switching, startSwitch] = useTransition();
  const isLogin = pathname === "/login";

  // The mouse wheel must never change a number field (amounts, NOP, rates): a focused number input lets go of focus
  // before the wheel acts, so the wheel scrolls the page instead. Covers every number field, including future ones.
  useEffect(() => {
    const releaseNumberField = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) target.blur();
    };
    document.addEventListener("wheel", releaseNumberField, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", releaseNumberField, { capture: true });
  }, []);

  useEffect(() => {
    if (isLogin) return;
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) return;
        const roleNames: string[] = Array.isArray(result.user?.roleNames) ? result.user.roleNames.map(String) : [];
        setUser({ name: String(result.user?.name ?? ""), employeeId: String(result.user?.employeeId ?? "") });
        setAccess({
          roleNames,
          permissions: {
            manageUsers: Boolean(result.user?.permissions?.manageUsers),
            manageAttendance: Boolean(result.user?.permissions?.manageAttendance),
            viewAttendanceReports: Boolean(result.user?.permissions?.viewAttendanceReports),
          },
          rolePages: result.user?.rolePages && typeof result.user.rolePages === "object" ? result.user.rolePages : {},
        });
        const available = roleOptions(roleNames);
        const saved = readPreference(preferenceKeys.activeRole);
        const resolved = available.find((role) => normalizeRole(role) === normalizeRole(saved)) ?? available[0];
        setActiveRole(resolved);
        // The server renders the dashboard for this role; re-render it if it was drawn for a different one.
        const drawnFor = document.cookie.split("; ").find((item) => item.startsWith(`${ACTIVE_ROLE_COOKIE}=`))?.split("=")[1] ?? "";
        writeActiveRoleCookie(resolved);
        if (normalizeRole(safeDecode(drawnFor)) !== normalizeRole(resolved) && window.location.pathname === "/") router.refresh();
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isLogin, router]);

  useEffect(() => {
    const applyDensity = () => { document.documentElement.dataset.density = readDensity(); };
    applyDensity();
    return onPreferencesChange(applyDensity);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const roles = useMemo(() => roleOptions(access.roleNames), [access.roleNames]);
  const sections = useMemo(() => activeRole ? visibleNavigation(activeRole, access) : [], [activeRole, access]);

  // Choosing a workspace opens its dashboard (the server draws it for the role in the cookie). Until it arrives the
  // page shows that it is loading instead of the previous workspace's dashboard.
  function chooseRole(role: string) {
    setActiveRole(role);
    writePreference(preferenceKeys.activeRole, role);
    writeActiveRoleCookie(role);
    setMobileOpen(false);
    startSwitch(() => { if (pathname === "/") router.refresh(); else router.push("/"); });
  }

  if (isLogin) return <>{children}</>;

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden">
      <Sidebar sections={sections} roles={roles} activeRole={activeRole} onRoleChange={chooseRole} user={user} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <main className="app-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <Topbar sections={sections} activeRole={activeRole} user={user} onMenu={() => setMobileOpen(true)} />
        {switching && <div role="status" aria-live="polite" className="sticky top-0 z-30 h-1 w-full overflow-hidden bg-primary/15"><div className="h-full w-1/3 animate-[workspace-loading_1.1s_ease-in-out_infinite] bg-primary" /><span className="sr-only">Opening the {activeRole} dashboard</span></div>}
        <div className={`app-content mx-auto w-full max-w-[1920px] px-3 pb-8 pt-4 transition-opacity sm:px-4 md:px-6 md:pt-5 ${switching ? "pointer-events-none opacity-50" : ""}`} aria-busy={switching}>
          {switching && <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary">Opening the {activeRole} dashboard...</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

// Every employee may manage members, so MAS is always offered as a workspace (see docs/access-control.md),
// except to executives whose only roles are CEO / President: their workspace is the dashboard and attendance.
function roleOptions(roleNames: string[]) {
  const executiveOnly = roleNames.length > 0 && roleNames.every((role) => executiveRoles.includes(normalizeRole(role)));
  return [...new Map([...roleNames, ...(executiveOnly ? [] : ["MAS"])].map((role) => [normalizeRole(role), role])).values()];
}
