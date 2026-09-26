"use client";

import { useEffect, useState } from "react";
import { LogOut, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

 type SessionUser = {
  employeeId: string;
  username: string;
  roles: string[];
  permissions: Record<string, boolean>;
};

const permissionLabels: Record<string, string> = {
  manageUsers: "Manage user accounts",
  manageAttendance: "Manage attendance",
  manageEmployees: "Manage employees",
  manageBranches: "Manage branches",
  managePrograms: "Manage programs",
};

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [compactTables, setCompactTables] = useState(false);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Unable to load account settings.");
        }

        setUser(result.user); setUsername(result.user.username);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to load account settings.",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadSession();
  }, []);

  const signOut = async () => {
    setSigningOut(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  const permissions = user
    ? Object.entries(user.permissions).filter(([, enabled]) => enabled)
    : [];

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, access, and workspace preferences.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <UserRound className="size-5" />
              </div>
              <div>
                <CardTitle>Account</CardTitle>
                <CardDescription>Your signed-in Dayong account.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading account...</p>
            ) : user ? (
              <div className="divide-y rounded-lg border">
                <div className="flex items-center justify-between gap-4 p-4">
                  <span className="text-sm text-muted-foreground">Username</span>
                  <span className="text-sm font-medium">{user.username}</span>
                </div>
                <div className="flex items-center justify-between gap-4 p-4">
                  <span className="text-sm text-muted-foreground">Employee ID</span>
                  <span className="text-sm font-medium">{user.employeeId}</span>
                </div>
                <div className="flex items-center justify-between gap-4 p-4">
                  <span className="text-sm text-muted-foreground">Roles</span>
                  <div className="flex flex-wrap justify-end gap-2">
                    {user.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <CardTitle>Access</CardTitle>
                <CardDescription>Permissions assigned to your account.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading permissions...</p>
            ) : permissions.length > 0 ? (
              <div className="space-y-2">
                {permissions.map(([permission]) => (
                  <div
                    key={permission}
                    className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <ShieldCheck className="size-4 text-emerald-600" />
                    {permissionLabels[permission] || permission}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No additional permissions assigned.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-700">
              <SlidersHorizontal className="size-5" />
            </div>
            <div>
              <CardTitle>Workspace preferences</CardTitle>
              <CardDescription>Adjust how dense operational lists feel on this device.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Compact tables</p>
              <p className="text-sm text-muted-foreground">
                Use tighter spacing in tables and directory lists.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={compactTables}
              onClick={() => setCompactTables((current) => !current)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${compactTables ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <span
                className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${compactTables ? "translate-x-6" : "translate-x-1"}`}
              />
              <span className="sr-only">Toggle compact tables</span>
            </button>
          </div>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Security and sign-in</CardTitle><CardDescription>Change your username or password. Your current password is required.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setAccountMessage(""); try { const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, currentPassword, newPassword }) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to update account."); setUser((current) => current ? { ...current, username: result.username } : current); setCurrentPassword(""); setNewPassword(""); setAccountMessage("Account settings updated."); } catch (failure) { setAccountMessage(failure instanceof Error ? failure.message : "Unable to update account."); } finally { setSaving(false); } }}><div className="space-y-2"><Label htmlFor="settings-username">Username</Label><Input id="settings-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username"/></div><div className="space-y-2"><Label htmlFor="current-password">Current password *</Label><Input id="current-password" type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password"/></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password"/><p className="text-xs text-muted-foreground">Leave blank to keep the current password. New passwords require at least 12 characters.</p></div><div className="flex items-end"><Button disabled={saving}>{saving ? "Saving..." : "Save sign-in settings"}</Button></div>{accountMessage && <p className="text-sm sm:col-span-2" role="status">{accountMessage}</p>}</form></CardContent></Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>End access on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            <LogOut className="mr-2 size-4" />
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
