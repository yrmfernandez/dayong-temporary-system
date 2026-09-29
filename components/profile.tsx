"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Building2, BriefcaseBusiness, CalendarDays, IdCard, LogOut, Mail, Phone, Settings, ShieldCheck, UserRound } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { preferenceKeys, removePreference } from "@/lib/ui-preferences";
import { clearFormDrafts } from "@/lib/use-form-draft";

export type Profile = {
  name: string;
  employeeId: string;
  userId: string;
  accountRoles: string[];
  permissions: Record<string, boolean>;
  accountStatus: string;
  accountCreatedAt: string;
  employeeLinkIssue: string;
  employee: null | {
    id: string;
    operationalRoles: string[];
    employmentStatus: string;
    contact: string;
    email: string;
    dateHired: string;
    primaryBranch: string;
    branches: Array<{ id: string; name: string; territory: string }>;
  };
};

export const permissionLabels: Record<string, string> = {
  manageUsers: "Manage user accounts",
  manageAttendance: "Manage attendance",
  viewAttendanceReports: "View attendance reports",
};

export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)) || "?";
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-lime to-brand-moss text-xs font-bold uppercase text-[#14101a] shadow-md", className)}>{initials(name)}</span>;
}

/** Loads the signed-in person's profile; `enabled` lets a menu wait until it is first opened. */
export function useProfile(enabled = true) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || profile) return;
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load your profile.");
        if (!cancelled) setProfile(result.profile);
      })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load your profile."); });
    return () => { cancelled = true; };
  }, [enabled, profile, attempt]);
  const reload = useCallback(() => { setError(""); setProfile(null); setAttempt((value) => value + 1); }, []);
  return { profile, error, loading: enabled && !profile && !error, reload };
}

const dateText = (value: string) => {
  if (!value) return "";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(date);
};

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="flex items-start gap-3">
    <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><div className="text-sm break-words">{children}</div></div>
  </div>;
}

const notRecorded = <span className="text-muted-foreground">Not recorded</span>;

/** Everything about the signed-in person. `compact` is the profile card; the full view is Settings → My profile. */
export function ProfileDetails({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const employee = profile.employee;
  const permissions = Object.entries(profile.permissions).filter(([, enabled]) => enabled).map(([key]) => permissionLabels[key] || key);
  // The card stays short: the first few branches, with the full list in My profile.
  const names = employee?.branches.map((branch) => branch.name) ?? [];
  const branches = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
  const linkIssue = profile.employeeLinkIssue && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{profile.employeeLinkIssue} Ask an administrator to correct it in User Accounts or Employees.</p>;
  if (compact) return <div className="space-y-3">
    {linkIssue}
    <Detail icon={<Building2 />} label={employee?.branches.length === 1 ? "Branch" : "Branches"}>{branches || notRecorded}</Detail>
    <Detail icon={<BriefcaseBusiness />} label="Operational roles">{employee?.operationalRoles.join(", ") || notRecorded}</Detail>
    <Detail icon={<Phone />} label="Contact">{[employee?.contact, employee?.email].filter(Boolean).join(" · ") || notRecorded}</Detail>
  </div>;
  return <div className="grid gap-6 lg:grid-cols-2">
    {linkIssue && <div className="lg:col-span-2">{linkIssue}</div>}
    <section className="space-y-4 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Employment</h3>
      {employee ? <>
        <Detail icon={<IdCard />} label="Employee ID"><span className="font-mono">{employee.id}</span></Detail>
        <Detail icon={<UserRound />} label="Employment status">{employee.employmentStatus ? <StatusBadge status={employee.employmentStatus} /> : notRecorded}</Detail>
        <Detail icon={<BriefcaseBusiness />} label="Operational roles">{employee.operationalRoles.join(", ") || notRecorded}</Detail>
        <Detail icon={<Building2 />} label="Assigned branches">{employee.branches.length ? <ul className="space-y-0.5">{employee.branches.map((branch) => <li key={branch.id || branch.name}>{branch.name}{branch.name === employee.primaryBranch && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">primary</span>}{branch.territory && <span className="text-muted-foreground"> · {branch.territory}</span>}</li>)}</ul> : notRecorded}</Detail>
        <Detail icon={<CalendarDays />} label="Date hired">{dateText(employee.dateHired) || notRecorded}</Detail>
      </> : <p className="text-sm text-muted-foreground">No employee record is linked to this sign-in ({profile.employeeId}).</p>}
    </section>
    <section className="space-y-4 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Contact</h3>
      <Detail icon={<Phone />} label="Contact number">{employee?.contact || notRecorded}</Detail>
      <Detail icon={<Mail />} label="Email">{employee?.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${employee.email}`}>{employee.email}</a> : notRecorded}</Detail>
      <p className="text-xs text-muted-foreground">To correct your details, ask HR or an administrator to update your employee record.</p>
    </section>
    <section className="space-y-4 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Sign-in account</h3>
      <Detail icon={<IdCard />} label="Sign-in ID">
        <span className="font-mono">{profile.employeeId}</span>
      </Detail>
      <Detail icon={<UserRound />} label="Account status"><StatusBadge status={profile.accountStatus} /></Detail>
      <Detail icon={<ShieldCheck />} label="Account roles"><div className="flex flex-wrap gap-1.5">{profile.accountRoles.length ? profile.accountRoles.map((role) => <span key={role} className="tone-chip tone-brand rounded-full px-2 py-0.5 text-xs font-semibold">{role}</span>) : notRecorded}</div></Detail>
      <Detail icon={<CalendarDays />} label="Account created">{dateText(profile.accountCreatedAt) || notRecorded}</Detail>
    </section>
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Access</h3>
      {permissions.length ? <ul className="space-y-2">{permissions.map((label) => <li key={label} className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-emerald-600" />{label}</li>)}</ul>
        : <p className="text-sm text-muted-foreground">Standard access for your roles. No extra permissions.</p>}
      <p className="text-xs text-muted-foreground">Page access follows your account roles and updates the next time you sign in.</p>
    </section>
  </div>;
}

/**
 * The avatar/name button that opens a profile card in place: who you are, where you work, and quick links to
 * your full profile, Settings, and sign out.
 */
export function ProfileMenu({ name, employeeId, activeRole, children, triggerClassName, side = "top", onNavigate }: {
  name: string; employeeId: string; activeRole?: string; children: ReactNode; triggerClassName?: string;
  side?: "top" | "bottom" | "right"; onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { profile, error, loading, reload } = useProfile(open);
  const go = () => { setOpen(false); onNavigate?.(); };
  async function signOut() {
    setSigningOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally {
      removePreference(preferenceKeys.activeRole);
      clearFormDrafts();
      go();
      router.replace("/login");
      router.refresh();
    }
  }
  const linkClass = "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted";
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger aria-label={`Your profile: ${name}`} className={triggerClassName}>{children}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side={side} align={side === "bottom" ? "end" : "start"} sideOffset={8} className="z-[70]">
        <Popover.Popup className="w-[min(20rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-2xl border bg-popover p-4 text-popover-foreground shadow-2xl outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <div className="flex items-center gap-3 border-b pb-3">
            <Avatar name={name} className="size-11 text-sm" />
            <div className="min-w-0">
              <Popover.Title className="truncate font-semibold">{profile?.name || name}</Popover.Title>
              <p className="truncate font-mono text-xs text-muted-foreground">{employeeId}</p>
              {activeRole && <span className="tone-chip tone-brand mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold">{activeRole}</span>}
            </div>
          </div>
          <div className="py-3">
            {profile ? <ProfileDetails profile={profile} compact />
              : error ? <p className="text-sm text-destructive">{error} <button type="button" className="underline" onClick={reload}>Retry</button></p>
              : <p className="text-sm text-muted-foreground" aria-live="polite">{loading ? "Loading your profile..." : ""}</p>}
          </div>
          <nav className="space-y-0.5 border-t pt-2" aria-label="Account">
            <Link href="/settings?tab=profile" className={linkClass} onClick={go}><UserRound className="size-4" />My profile</Link>
            <Link href="/settings?tab=preferences" className={linkClass} onClick={go}><Settings className="size-4" />Settings</Link>
            <button type="button" className={cn(linkClass, "w-full text-destructive hover:bg-destructive/10")} disabled={signingOut} onClick={() => void signOut()}><LogOut className="size-4" />{signingOut ? "Signing out..." : "Sign out"}</button>
          </nav>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
