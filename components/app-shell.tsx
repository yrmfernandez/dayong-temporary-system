"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import type { AccessContext } from "@/lib/access-control";
import { isInWorkspace, normalizeRole, visibleNavigation } from "@/lib/navigation";
import { onPreferencesChange, preferenceKeys, readDensity, readPreference, writePreference } from "@/lib/ui-preferences";

export type ShellUser = { username: string; employeeId: string };

const emptyAccess: AccessContext = { roleNames: [], permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false } };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ShellUser | null>(null);
  const [access, setAccess] = useState<AccessContext>(emptyAccess);
  const [activeRole, setActiveRole] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) return;
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) return;
        const roleNames: string[] = Array.isArray(result.user?.roleNames) ? result.user.roleNames.map(String) : [];
        setUser({ username: String(result.user?.username ?? ""), employeeId: String(result.user?.employeeId ?? "") });
        setAccess({
          roleNames,
          permissions: {
            manageUsers: Boolean(result.user?.permissions?.manageUsers),
            manageAttendance: Boolean(result.user?.permissions?.manageAttendance),
            viewAttendanceReports: Boolean(result.user?.permissions?.viewAttendanceReports),
          },
        });
        const available = roleOptions(roleNames);
        const saved = readPreference(preferenceKeys.activeRole);
        setActiveRole(available.find((role) => normalizeRole(role) === normalizeRole(saved)) ?? available[0]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isLogin]);

  useEffect(() => {
    const applyDensity = () => { document.documentElement.dataset.density = readDensity(); };
    applyDensity();
    return onPreferencesChange(applyDensity);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const roles = useMemo(() => roleOptions(access.roleNames), [access.roleNames]);
  const sections = useMemo(() => activeRole ? visibleNavigation(activeRole, access) : [], [activeRole, access]);

  function chooseRole(role: string) {
    setActiveRole(role);
    writePreference(preferenceKeys.activeRole, role);
    if (!isInWorkspace(role, pathname)) router.push("/");
  }

  if (isLogin) return <>{children}</>;

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden">
      <Sidebar sections={sections} roles={roles} activeRole={activeRole} onRoleChange={chooseRole} user={user} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <main className="app-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <Topbar sections={sections} activeRole={activeRole} user={user} onMenu={() => setMobileOpen(true)} />
        <div className="app-content mx-auto w-full max-w-[1920px] px-3 pb-8 pt-4 sm:px-4 md:px-6 md:pt-5">{children}</div>
      </main>
    </div>
  );
}

// Every employee may manage members, so MAS is always offered as a workspace (see docs/access-control.md).
function roleOptions(roleNames: string[]) {
  return [...new Map([...roleNames, "MAS"].map((role) => [normalizeRole(role), role])).values()];
}
