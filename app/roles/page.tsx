"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { defaultRoutesForRole, isAdministratorRole } from "@/lib/access-control";
import { pageCatalog, pageCatalogRoutes } from "@/lib/page-catalog";

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

  function edit(role: Role) {
    setForm({ ...role, pages: effectivePages(role) });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    if (response.ok) { setForm(empty); await load(); } else setBusy(false);
  }

  async function remove(role: Role) {
    if (!confirm(`Delete ${role.name}?`)) return;
    const response = await fetch("/api/roles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: role.id }) });
    const result = await response.json();
    setMessage(response.ok ? "Role deleted." : result.message);
    if (response.ok) await load();
  }

  return <section className="mx-auto max-w-6xl space-y-6">
    <div><h1 className="text-2xl font-bold">Role Management</h1><p className="text-sm text-muted-foreground">Create roles, set their permissions, and choose which pages each role can open.</p></div>

    <Card>
      <CardHeader><CardTitle>{form.id ? `Edit ${form.name}` : "Add role"}</CardTitle><CardDescription>Dashboard and Settings are always available to every role.</CardDescription></CardHeader>
      <CardContent>
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

          <div className="flex gap-2"><Button disabled={busy}>{form.id ? "Save role" : "Add role"}</Button>{form.id && <Button type="button" variant="ghost" onClick={() => setForm(empty)}>Cancel</Button>}</div>
        </form>
      </CardContent>
    </Card>

    {message && <p className="rounded-md border bg-background p-3 text-sm" role="status">{message}</p>}

    <div className="overflow-x-auto rounded-xl border bg-background"><table className="w-full min-w-[820px] text-left text-sm">
      <thead><tr>{["Role ID", "Name", "Permissions", "Pages", "Status", "Actions"].map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead>
      <tbody>{roles.map((role) => <tr key={role.id} className="border-t">
        <td className="p-3 font-mono text-xs">{role.id}</td>
        <td className="p-3"><strong>{role.name}</strong><p className="text-xs text-muted-foreground">{role.description}</p></td>
        <td className="p-3">{[role.manageUsers && "Users", role.manageAttendance && "Attendance", role.viewAttendanceReports && "Attendance reports"].filter(Boolean).join(", ") || "Standard access"}</td>
        <td className="p-3">{isAdministratorRole(role.name) ? "All pages" : role.pages ? `${role.pages.length} selected` : "Defaults"}</td>
        <td className="p-3">{role.status}</td>
        <td className="p-3"><div className="flex gap-2"><Button variant="outline" onClick={() => edit(role)}>Edit</Button><Button variant="outline" className="text-destructive" onClick={() => void remove(role)}>Delete</Button></div></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
