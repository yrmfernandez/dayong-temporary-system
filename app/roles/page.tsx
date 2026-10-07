"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { InlineRow } from "@/components/inline-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { defaultRoutesForRole, isAdministratorRole } from "@/lib/access-control";
import { pageCatalog, pageCatalogRoutes } from "@/lib/page-catalog";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Role = { id: string; name: string; description: string; manageUsers: boolean; manageAttendance: boolean; viewAttendanceReports: boolean; status: "active" | "inactive"; pages: string[] | null };
const permissionLabels = [["manageUsers", "Manage users and master data"], ["manageAttendance", "Manage attendance"], ["viewAttendanceReports", "View attendance reports"]] as const;

// Blank page access means the role still uses its built-in defaults; show those as the starting selection.
const effectivePages = (role: Pick<Role, "name" | "pages">) => role.pages ?? defaultRoutesForRole(role.name).filter((route) => pageCatalogRoutes.includes(route));
// New roles start from the shared employee workspace.
const empty: Role = { id: "", name: "", description: "", manageUsers: false, manageAttendance: false, viewAttendanceReports: false, status: "active", pages: effectivePages({ name: "", pages: null }) };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<Role>(empty);
  const [message, setMessage] = useState("");
  // The role just saved, so its confirmation shows on its row instead of above the table.
  const [savedId, setSavedId] = useState("");
  const [busy, setBusy] = useState(true);
  const admin = isAdministratorRole(form.name);
  const selected = useMemo(() => new Set(form.pages ?? []), [form.pages]);

  const load = useCallback(async () => {
    setBusy(true);
    const response = await fetch("/api/roles", { cache: "no-store" });
    const result = await response.json();
    setMessage(response.ok ? "" : result.message);
    setRoles(result.roles ?? []);
    setBusy(false);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["roles", "user_roles"], load);

  // Edit opens under the role's row; clicking Edit again closes it.
  function edit(role: Role) {
    setSavedId("");
    setMessage("");
    setForm(form.id === role.id ? empty : { ...role, pages: effectivePages(role) });
  }

  function togglePage(href: string, checked: boolean) {
    setForm((current) => ({ ...current, pages: checked ? [...new Set([...(current.pages ?? []), href])] : (current.pages ?? []).filter((page) => page !== href) }));
  }

  function toggleGroup(hrefs: string[], checked: boolean) {
    setForm((current) => ({ ...current, pages: checked ? [...new Set([...(current.pages ?? []), ...hrefs])] : (current.pages ?? []).filter((page) => !hrefs.includes(page)) }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/roles", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json();
    setMessage(response.ok ? `Role ${form.id ? "updated" : "created"}. Page access applies the next time its users sign in.` : result.message);
    if (response.ok) { setSavedId(form.id ?? ""); setForm(empty); await load(); } else setBusy(false);
  }

  async function remove(role: Role) {
    if (!confirm(`Delete ${role.name}?`)) return;
    setSavedId("");
    const response = await fetch("/api/roles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: role.id }) });
    const result = await response.json();
    setMessage(response.ok ? "Role deleted." : result.message);
    if (response.ok) await load();
  }

  const roleForm = (
  <form onSubmit={save} className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Role name<Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="space-y-1 text-sm">Status<select className="h-9 w-full rounded-md border bg-background px-3" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Role["status"] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="space-y-1 text-sm sm:col-span-2">Description<Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
    </div>

    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Permissions</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{permissionLabels.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />{label}</label>)}</div>
    </fieldset>

    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <legend className="text-sm font-semibold">Page access</legend>
        {!admin && <div className="flex gap-2 text-xs"><button type="button" className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setForm({ ...form, pages: [...pageCatalogRoutes] })}>Select all</button><button type="button" className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setForm({ ...form, pages: [] })}>Clear</button><button type="button" className="rounded-md border px-2 py-1 hover:bg-muted" onClick={() => setForm({ ...form, pages: defaultRoutesForRole(form.name).filter((route) => pageCatalogRoutes.includes(route)) })}>Reset to defaults</button></div>}
      </div>
      {admin
        ? <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Administrator always has access to every page.</p>
        : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{pageCatalog.map((group) => {
          const hrefs = group.pages.map((page) => page.href);
          const all = hrefs.every((href) => selected.has(href));
          return <div key={group.group} className="rounded-lg border p-3">
            <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><input type="checkbox" checked={all} ref={(input) => { if (input) input.indeterminate = !all && hrefs.some((href) => selected.has(href)); }} onChange={(event) => toggleGroup(hrefs, event.target.checked)} />{group.group}</label>
            <div className="space-y-1.5">{group.pages.map((page) => <label key={page.href} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.has(page.href)} onChange={(event) => togglePage(page.href, event.target.checked)} />{page.label}</label>)}</div>
          </div>;
        })}</div>}
      <p className="text-xs text-muted-foreground">Users receive the combined pages of all their roles. Changes apply the next time they sign in.</p>
    </fieldset>

    <div className="flex gap-2"><Button type="submit" disabled={busy}>{form.id ? "Save role" : "Add role"}</Button>{form.id && <Button type="button" variant="ghost" onClick={() => setForm(empty)}>Cancel</Button>}</div>
  </form>
  );

  return <section className="mx-auto max-w-6xl space-y-6">
    <div><h1 className="text-2xl font-bold">Role Management</h1><p className="text-sm text-muted-foreground">Create roles, set their permissions, and choose which pages each role can open.</p></div>

    {!form.id && <Card>
      <CardHeader><CardTitle>Add role</CardTitle><CardDescription>Dashboard and Settings are always available to every role.</CardDescription></CardHeader>
      <CardContent>
        {roleForm}
      </CardContent>
    </Card>}

    {message && !form.id && !savedId && <p className="rounded-md border bg-background p-3 text-sm" role="status">{message}</p>}

    <div className="overflow-x-auto rounded-xl border bg-background"><table className="w-full text-left text-sm">
      <thead><tr>{["Role ID", "Name", "Permissions", "Pages", "Status", "Actions"].map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead>
      <tbody>{roles.map((role) => <Fragment key={role.id}><tr className="border-t">
        <td className="p-3 font-mono text-xs">{role.id}</td>
        <td className="p-3"><strong>{role.name}</strong><p className="text-xs text-muted-foreground">{role.description}</p></td>
        <td className="p-3">{[role.manageUsers && "Users", role.manageAttendance && "Attendance", role.viewAttendanceReports && "Attendance reports"].filter(Boolean).join(", ") || "Standard access"}</td>
        <td className="p-3">{isAdministratorRole(role.name) ? "All pages" : role.pages ? `${role.pages.length} selected` : "Defaults"}</td>
        <td className="p-3">{role.status}</td>
        <td className="p-3"><div className="flex gap-2"><Button variant={form.id === role.id ? "default" : "outline"} aria-expanded={form.id === role.id} onClick={() => edit(role)}>{form.id === role.id ? "Editing" : "Edit"}</Button><Button variant="outline" className="text-destructive" onClick={() => void remove(role)}>Delete</Button></div></td>
      </tr>
      {savedId === role.id && !form.id && message && <tr><td colSpan={6} className="px-3 pb-3"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p></td></tr>}
      {form.id === role.id && <InlineRow colSpan={6}><p className="mb-3 text-sm font-semibold">Edit {role.name} <span className="font-normal text-muted-foreground">· Dashboard and Settings are always available.</span></p>{roleForm}{message && <p className="mt-3 text-sm" role="status">{message}</p>}</InlineRow>}
      </Fragment>)}</tbody>
    </table></div>
  </section>;
}
