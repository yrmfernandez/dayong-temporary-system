"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Building, CheckCircle2, Eye, EyeOff, LogOut, ShieldCheck, TriangleAlert, SlidersHorizontal, UserRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FinanceSettings } from "@/components/finance-settings";
import { Avatar, ProfileDetails, useProfile } from "@/components/profile";
import { ThemeToggle } from "@/components/theme-toggle";
import { RemittanceMethodSettings } from "@/components/remittance-method-settings";
import { onPreferencesChange, preferenceKeys, readDensity, readIndicator, removePreference, writePreference } from "@/lib/ui-preferences";
import { clearFormDrafts } from "@/lib/use-form-draft";

type SessionUser = { employeeId: string; name: string; roleNames: string[]; permissions: Record<string, boolean> };
type Tab = "profile" | "preferences" | "security" | "organization";

const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound; description: string }> = [
  { id: "profile", label: "My profile", icon: UserRound, description: "Your employee record, sign-in account, and access." },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal, description: "Theme, tables, and navigation on this device." },
  { id: "security", label: "Security", icon: ShieldCheck, description: "Password and signing out." },
  { id: "organization", label: "Organization", icon: Building, description: "Company-wide finance settings (administrators and Finance)." },
];

export default function SettingsPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading settings...</p>}><SettingsContent /></Suspense>;
}

function SettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionError, setSessionError] = useState("");
  const { profile, error: profileError, reload } = useProfile();

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load account settings.");
      setUser(result.user);
    }).catch((failure) => setSessionError(failure instanceof Error ? failure.message : "Unable to load account settings."));
  }, []);

  // Organization settings are company-wide; only administrators and Finance manage them.
  const canManageOrganization = Boolean(user && (user.permissions.manageUsers || user.roleNames.some((role) => ["administrator", "admin", "finance"].includes(role.trim().toLowerCase()))));
  const visibleTabs = tabs.filter((tab) => tab.id !== "organization" || canManageOrganization);
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = visibleTabs.some((item) => item.id === requested) ? requested! : "profile";
  const current = tabs.find((item) => item.id === tab)!;
  const choose = (next: Tab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={profile?.name || user?.name || "?"} className="size-14 text-base" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{profile?.name || user?.name || "Settings"}</h1>
          <p className="text-sm text-muted-foreground">{[profile?.employeeId || user?.employeeId, profile?.accountRoles.join(", ")].filter(Boolean).join(" · ") || "Your account, preferences, and security."}</p>
        </div>
      </div>

      {sessionError && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{sessionError}</div>}

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} onClick={() => choose(item.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === item.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-4" />{item.label}
          </button>;
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-6">
        <p className="text-sm text-muted-foreground">{current.description}</p>
        {tab === "profile" && (profile ? <ProfileDetails profile={profile} />
          : profileError ? <p className="text-sm text-destructive">{profileError} <button type="button" className="underline" onClick={reload}>Retry</button></p>
          : <p className="text-sm text-muted-foreground">Loading your profile...</p>)}
        {tab === "preferences" && <PreferencesTab />}
        {tab === "security" && <SecurityTab employeeId={user?.employeeId ?? profile?.employeeId ?? ""} required={searchParams.get("required") === "1"} />}
        {tab === "organization" && canManageOrganization && <><FinanceSettings /><RemittanceMethodSettings /></>}
      </div>
    </section>
  );
}

function PreferencesTab() {
  // Read from this device's storage after hydration (the server has no saved preference), and follow changes made elsewhere.
  const compactTables = useSyncExternalStore(onPreferencesChange, () => readDensity() === "compact", () => false);
  const indicator = useSyncExternalStore(onPreferencesChange, readIndicator, () => "pill" as const);
  const row = "flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4";
  return <Card>
    <CardHeader><CardTitle>Workspace preferences</CardTitle><CardDescription>Saved on this device only.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className={row}>
        <div><p className="text-sm font-medium">Color theme</p><p className="text-sm text-muted-foreground">Light, dark, or follow this device&apos;s setting. Printed reports always use light.</p></div>
        <ThemeToggle showLabels />
      </div>
      <div className={row}>
        <div><p className="text-sm font-medium">Sidebar active page style</p><p className="text-sm text-muted-foreground">Highlight the current page with a filled pill or a side line.</p></div>
        <div className="grid shrink-0 grid-cols-2 rounded-lg bg-muted p-1 text-xs" role="radiogroup" aria-label="Sidebar active page style">
          {(["pill", "line"] as const).map((style) => <button key={style} type="button" role="radio" aria-checked={indicator === style} onClick={() => writePreference(preferenceKeys.indicator, style)}
            className={`rounded-md px-3 py-1.5 capitalize ${indicator === style ? "bg-card font-semibold text-primary shadow-sm" : "text-muted-foreground"}`}>{style}</button>)}
        </div>
      </div>
      <div className={row}>
        <div><p className="text-sm font-medium">Compact tables</p><p className="text-sm text-muted-foreground">Use tighter spacing in tables and directory lists.</p></div>
        <button type="button" role="switch" aria-checked={compactTables} onClick={() => writePreference(preferenceKeys.density, compactTables ? "comfortable" : "compact")}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${compactTables ? "bg-primary" : "bg-muted-foreground/30"}`}>
          <span aria-hidden="true" className={`absolute left-0 top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${compactTables ? "translate-x-6" : "translate-x-1"}`} />
          <span className="sr-only">Toggle compact tables</span>
        </button>
      </div>
    </CardContent>
  </Card>;
}

function SecurityTab({ employeeId, required }: { employeeId: string; required: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setMessage(null);
    if (newPassword !== confirmPassword) { setMessage({ tone: "error", text: "Password not changed: the new passwords do not match." }); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update account.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      // The response carries a session without the change-password lock, so the rest of the system opens now.
      if (required) {
        // Let the user see the confirmation before the rest of the system opens.
        setMessage({ tone: "success", text: "Password changed successfully. Opening the system..." });
        setTimeout(() => { router.replace("/"); router.refresh(); }, 1500);
        return;
      }
      setMessage({ tone: "success", text: "Password changed successfully. Other devices signed in to this account will be signed out within a few minutes." });
    } catch (failure) { setMessage({ tone: "error", text: `Password not changed: ${failure instanceof Error ? failure.message : "Unable to update account."}` }); }
    finally { setSaving(false); }
  }

  async function signOut() {
    setSigningOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally {
      removePreference(preferenceKeys.activeRole);
      clearFormDrafts();
      router.replace("/login");
      router.refresh();
    }
  }

  return <>
    {required && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Change your password to continue</p><p className="mt-1">You signed in with the default or a weak password. Choose a new password of at least 12 characters; the rest of the system opens once it is saved.</p></div>}
    <Card>
      <CardHeader><CardTitle>Change password</CardTitle><CardDescription>You sign in with your Employee ID. Your current password is required.</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
          <div className="space-y-2"><Label htmlFor="settings-employee-id">Employee ID</Label><Input id="settings-employee-id" value={employeeId} readOnly className="bg-muted/50" autoComplete="username" /></div>
          <div className="space-y-2"><Label htmlFor="current-password">Current password *</Label><PasswordInput id="current-password" required value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" /></div>
          <div className="space-y-2"><Label htmlFor="new-password">New password *</Label><PasswordInput id="new-password" required minLength={12} value={newPassword} onChange={setNewPassword} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 12 characters.</p></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password *</Label><PasswordInput id="confirm-password" required minLength={12} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" /></div>
          <div className="flex items-end"><Button type="submit" disabled={saving || !employeeId}>{saving ? "Saving..." : "Change password"}</Button></div>
          {message && <div role={message.tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border p-3 text-sm sm:col-span-2 ${message.tone === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
            {message.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}<span>{message.text}</span>
          </div>}
        </form>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Session</CardTitle><CardDescription>End access on this device.</CardDescription></CardHeader>
      <CardContent><Button type="button" variant="destructive" disabled={signingOut} onClick={() => void signOut()}><LogOut className="mr-2 size-4" />{signingOut ? "Signing out..." : "Sign out"}</Button></CardContent>
    </Card>
  </>;
}

function PasswordInput({ id, value, onChange, required, minLength, autoComplete }: { id: string; value: string; onChange: (value: string) => void; required?: boolean; minLength?: number; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <Input id={id} type={visible ? "text" : "password"} required={required} minLength={minLength} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} className="pr-10" />
    <button type="button" onClick={() => setVisible((shown) => !shown)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} aria-controls={id}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground">
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  </div>;
}
