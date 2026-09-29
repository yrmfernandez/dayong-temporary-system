"use client";

import { useEffect, useState } from "react";

import { InlinePanel } from "@/components/inline-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { DEFAULT_PASSWORD } from "@/lib/default-password";

type Role = {
  id: string;
  name: string;
};
type Account = { id: string; employeeId: string; fullName: string; status: string; createdAt: string; roleIds: string[]; roles: string[] };

type RolesResponse = {
  success: boolean;
  roles?: Role[];
  employees?: { id: string; name: string; status: string; roleIds: string[] }[];
  accounts?: Account[];
  message?: string;
};

export default function UserAccountsPage() {
  const [employees, setEmployees] = useState<{ id: string; name: string; status: string; roleIds: string[] }[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  // The account just saved, so the confirmation shows on its card.
  const [savedId, setSavedId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [revision, setRevision] = useState(0);
  // "Find a person": `acct:USR-…` opens that account's editor; `emp:MD-…` offers to create a missing account.
  const [found, setFound] = useState("");
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadRoles = async () => {
      try {
        const response = await fetch(
          "/api/user-accounts",
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as RolesResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message ||
              "You are not allowed to manage user accounts.",
          );
        }

        setRoles(result.roles ?? []);
        setAccounts(result.accounts ?? []);
        setEmployees((result.employees ?? []).filter((e) => e.status.toLowerCase() === "active"));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load roles.",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadRoles();
  }, [revision]);

  const withoutAccount = employees.filter((employee) => !accounts.some((account) => account.employeeId === employee.id));
  const foundEmployee = found.startsWith("emp:") ? withoutAccount.find((employee) => employee.id === found.slice(4)) : undefined;

  function findPerson(value: string) {
    setFound(value); setMessage(""); setSavedId(""); setResetPassword("");
    if (value.startsWith("acct:")) { setEditing(accounts.find((account) => account.id === value.slice(5)) ?? null); return; }
    setEditing(null);
    setNewRoleIds(employees.find((employee) => employee.id === value.slice(4))?.roleIds ?? []);
  }

  async function createAccount() {
    if (!foundEmployee) return;
    if (!newRoleIds.length) { setMessage("Select at least one role."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/user-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: foundEmployee.id, roleIds: newRoleIds }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to create user account.");
      setMessage(`Account created for ${foundEmployee.name}. They sign in with ${foundEmployee.id} and the password ${DEFAULT_PASSWORD}, then change it in Settings → Security.`);
      setFound(""); setRevision((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create user account."); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          User Accounts
        </h1>

        <p className="text-sm text-muted-foreground">
          Sign-in accounts and their roles. Registering an employee creates their account automatically.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Find a person</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Checking access and loading accounts...</p>
            : roles.length === 0 ? <p className="text-sm text-destructive">{message || "No active roles are available, or you do not have access."}</p>
            : <>
              <SearchSelect aria-label="Find a person" placeholder="Search name, Employee ID, or role" value={found} clearable onValueChange={findPerson}
                options={[
                  ...accounts.map((account) => ({ value: `acct:${account.id}`, label: account.fullName, description: `${account.employeeId} · ${account.roles.join(", ") || "No roles"} · ${account.status}` })),
                  ...withoutAccount.map((employee) => ({ value: `emp:${employee.id}`, label: employee.name, description: `${employee.id} · No sign-in account yet` })),
                ]} />
              <p className="text-xs text-muted-foreground">New employees get a sign-in account automatically when they are registered (password <span className="font-mono">{DEFAULT_PASSWORD}</span>). Pick someone to edit their account, or to create one if it is missing.</p>
              {foundEmployee && <InlinePanel>
                <p className="text-sm font-semibold">{foundEmployee.name} <span className="font-mono font-normal text-muted-foreground">{foundEmployee.id}</span> has no sign-in account.</p>
                <div className="mt-3 grid gap-2 rounded-md border p-3 sm:grid-cols-2">{roles.map((role) => <label key={role.id} className="flex gap-2 text-sm"><input type="checkbox" checked={newRoleIds.includes(role.id)} onChange={() => setNewRoleIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} />{role.name}</label>)}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" disabled={saving || !newRoleIds.length} onClick={() => void createAccount()}>{saving ? "Creating..." : "Create account"}</Button><span className="text-xs text-muted-foreground">Password: <span className="font-mono">{DEFAULT_PASSWORD}</span></span></div>
              </InlinePanel>}
              {message && !editing && !savedId && <p className="text-sm" role="status">{message}</p>}
            </>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Existing Accounts</CardTitle></CardHeader><CardContent className="space-y-3">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{account.fullName}</p><p className="text-sm text-muted-foreground">{account.employeeId} · {account.status}</p><p className="text-xs text-muted-foreground">{account.roles.join(", ") || "No roles"}</p></div><div className="flex gap-2"><Button variant={editing?.id === account.id ? "default" : "outline"} aria-expanded={editing?.id === account.id} onClick={() => { setMessage(""); setSavedId(""); setResetPassword(""); setFound(editing?.id === account.id ? "" : `acct:${account.id}`); setEditing((current) => current?.id === account.id ? null : account); }}>{editing?.id === account.id ? "Editing" : "Edit"}</Button><Button variant="outline" className="text-destructive" onClick={async () => { if (!window.confirm(`Delete the account for ${account.fullName} (${account.employeeId})?`)) return; setSavedId(""); const response = await fetch("/api/user-accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id }) }); const result = await response.json(); setMessage(response.ok && result.success ? "Account deleted." : result.message || "Unable to delete account."); if (response.ok) setRevision((value) => value + 1); }}>Delete</Button></div>{savedId === account.id && !editing && message && <p role="status" className="basis-full rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p>}{editing?.id === account.id && <InlinePanel className="basis-full"><p className="mb-3 text-sm font-semibold">Edit {editing.fullName}</p><form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setMessage(""); setSaving(true); try { const response = await fetch("/api/user-accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, status: editing.status, roleIds: editing.roleIds, password: resetPassword }) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to update account."); setSavedId(editing.id); setEditing(null); setResetPassword(""); setMessage("Account updated."); setRevision((value) => value + 1); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update account."); } finally { setSaving(false); } }}><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Sign-in ID</Label><Input value={editing.employeeId} readOnly className="bg-muted/50 font-mono"/></div><div className="space-y-2"><Label>Status</Label><select className="w-full rounded-md border bg-background p-2" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div><div className="space-y-2"><Label>New temporary password</Label><Input type="password" minLength={12} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Leave blank to keep password"/><button type="button" className="text-xs font-medium text-primary underline" onClick={() => setResetPassword(DEFAULT_PASSWORD)}>Reset to default password ({DEFAULT_PASSWORD})</button></div></div><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{roles.map((role) => <label key={role.id} className="flex gap-2 text-sm"><input type="checkbox" checked={editing.roleIds.includes(role.id)} onChange={() => setEditing({ ...editing, roleIds: editing.roleIds.includes(role.id) ? editing.roleIds.filter((id) => id !== role.id) : [...editing.roleIds, role.id] })}/>{role.name}</label>)}</div>{message && <p className="text-sm text-muted-foreground">{message}</p>}<div className="flex gap-2"><Button type="submit" disabled={saving || editing.roleIds.length === 0}>{saving ? "Saving..." : "Save Account"}</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></form></InlinePanel>}</div>)}{!accounts.length && <p className="text-sm text-muted-foreground">No user accounts found.</p>}</CardContent></Card>
    </div>
  );
}
