"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [resetPassword, setResetPassword] = useState("");
  const [revision, setRevision] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
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

  const toggleRole = (roleId: string) => {
    setRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  };

  const createAccount = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setMessage("");

    if (
      !employeeId.trim() ||
      !fullName.trim() ||
      !password
    ) {
      setMessage(
        "Select an employee and enter a temporary password.",
      );
      return;
    }

    if (roleIds.length === 0) {
      setMessage("Select at least one role.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/user-accounts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employeeId,
            fullName,
            password,
            roleIds,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to create user account.",
        );
      }

      setEmployeeId("");
      setFullName("");
      setPassword("");
      setRoleIds([]);
      setMessage("Employee account created successfully.");
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create user account.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          User Accounts
        </h1>

        <p className="text-sm text-muted-foreground">
          Create login accounts and assign employee roles.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Employee Account</CardTitle>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Checking access and loading roles...
            </p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-destructive">
              {message ||
                "No active roles are available, or you do not have access."}
            </p>
          ) : (
            <form
              className="space-y-5"
              onSubmit={createAccount}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="employee-id">
                    Employee ID *
                  </Label>
                  <Input id="employee-id" list="employee-options" required aria-label="Search and select employee" placeholder="Type an ID or employee name" value={employeeSearch} onChange={(event) => { const value = event.target.value; setEmployeeSearch(value); const employee = employees.find((item) => `${item.id} - ${item.name}` === value); setEmployeeId(employee?.id ?? ""); setFullName(employee?.name ?? ""); setRoleIds(employee?.roleIds ?? []); }} disabled={saving}/>
                  <datalist id="employee-options">{employees.map((employee) => <option key={employee.id} value={`${employee.id} - ${employee.name}`} />)}</datalist>
                  <input type="hidden" name="employeeId" value={employeeId}/>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="full-name">
                    Full Name *
                  </Label>

                  <Input
                    id="full-name"
                    readOnly
                    value={fullName}
                    onChange={(event) =>
                      setFullName(event.target.value)
                    }
                    disabled={saving}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account-employee-id">
                    Sign-in ID
                  </Label>

                  <Input
                    id="account-employee-id"
                    readOnly
                    value={employeeId}
                    placeholder="Select an employee"
                    className="bg-muted/50 font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Employees sign in with their Employee ID.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account-password">
                    Temporary Password *
                  </Label>

                  <Input
                    id="account-password"
                    type="password"
                    minLength={12}
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    autoComplete="new-password"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Roles *</Label>

                <p className="text-xs text-muted-foreground">The employee&apos;s operational roles are selected automatically. An administrator may add or remove account roles before creating the login.</p>

                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={roleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                        disabled={saving}
                      />

                      <span>
                        {role.name}{" "}
                        <span className="text-muted-foreground">
                          ({role.id})
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {message && (
                <p className="text-sm text-muted-foreground">
                  {message}
                </p>
              )}

              <Button type="submit" disabled={saving}>
                {saving
                  ? "Creating Account..."
                  : "Create Account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Existing Accounts</CardTitle></CardHeader><CardContent className="space-y-3">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{account.fullName}</p><p className="text-sm text-muted-foreground">{account.employeeId} · {account.status}</p><p className="text-xs text-muted-foreground">{account.roles.join(", ") || "No roles"}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => { setEditing(account); setResetPassword(""); }}>Edit</Button><Button variant="outline" className="text-destructive" onClick={async () => { if (!window.confirm(`Delete the account for ${account.fullName} (${account.employeeId})?`)) return; const response = await fetch("/api/user-accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id }) }); const result = await response.json(); setMessage(response.ok && result.success ? "Account deleted." : result.message || "Unable to delete account."); if (response.ok) setRevision((value) => value + 1); }}>Delete</Button></div></div>)}{!accounts.length && <p className="text-sm text-muted-foreground">No user accounts found.</p>}</CardContent></Card>
      {editing && <Card><CardHeader><CardTitle>Edit {editing.fullName}</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setMessage(""); setSaving(true); try { const response = await fetch("/api/user-accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, status: editing.status, roleIds: editing.roleIds, password: resetPassword }) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to update account."); setEditing(null); setResetPassword(""); setMessage("Account updated."); setRevision((value) => value + 1); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update account."); } finally { setSaving(false); } }}><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Sign-in ID</Label><Input value={editing.employeeId} readOnly className="bg-muted/50 font-mono"/></div><div className="space-y-2"><Label>Status</Label><select className="w-full rounded-md border bg-background p-2" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div><div className="space-y-2"><Label>New temporary password</Label><Input type="password" minLength={12} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Leave blank to keep password"/></div></div><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{roles.map((role) => <label key={role.id} className="flex gap-2 text-sm"><input type="checkbox" checked={editing.roleIds.includes(role.id)} onChange={() => setEditing({ ...editing, roleIds: editing.roleIds.includes(role.id) ? editing.roleIds.filter((id) => id !== role.id) : [...editing.roleIds, role.id] })}/>{role.name}</label>)}</div>{message && <p className="text-sm text-muted-foreground">{message}</p>}<div className="flex gap-2"><Button type="submit" disabled={saving || editing.roleIds.length === 0}>{saving ? "Saving..." : "Save Account"}</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></form></CardContent></Card>}
    </div>
  );
}
