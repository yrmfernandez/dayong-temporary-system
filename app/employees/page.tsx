"use client";

import {
  Fragment,
  useEffect,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { readApiResponse } from "@/lib/api-response";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { InlineRow } from "@/components/inline-panel";
import { StatusBadge } from "@/components/status-badge";
import { type IssuedPassword, OneTimePasswordNotice } from "@/components/one-time-password";

type Employee = { id: string; name: string; status: string; branch: string; primaryBranchId: string; hasAccount: boolean; branchIds: string[]; roles: string[]; roleIds:string[]; createdAt: string; contact: string; email: string; dateHired: string };
const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

export default function EmployeesPage() {
  const [canRegister, setCanRegister] = useState(false);
  const [canManage, setCanManage] = useState(false);
  // Only administrators change an Employee ID (it is also the sign-in ID).
  const [canChangeId, setCanChangeId] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; territory?: string }>>([]);
  const [operationalRoles, setOperationalRoles] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  // Primary branch = the chosen one if still ticked, else the first ticked branch.
  const [selectedPrimaryId, setSelectedPrimaryId] = useState("");
  const registerPrimaryId = selectedBranchIds.includes(selectedPrimaryId) ? selectedPrimaryId : selectedBranchIds[0] ?? "";
  const [editing, setEditing] = useState<Employee | null>(null);
  // The employee just saved, so the confirmation shows on that row.
  const [savedId, setSavedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // The new account's one-time password, returned only to IT and administrators.
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"name" | "id" | "branch" | "status">("name");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [suggestedEmployeeId, setSuggestedEmployeeId] = useState("");
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/employees", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load employees.");
      setEmployees(result.employees); setCanRegister(result.canRegister); setCanManage(result.canManage); setCanChangeId(Boolean(result.canChangeId));
      setBranches(result.branches ?? []); setOperationalRoles(result.operationalRoles ?? []);
      setSuggestedEmployeeId(result.nextEmployeeId ?? ""); setNewEmployeeId(result.nextEmployeeId ?? "");
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load employees."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision]);
  const toggleEmployee = (employeeId: string) => {
    setExpandedEmployeeId((current) => current === employeeId ? null : employeeId);
  };
  async function changeEmployee(method: "PATCH" | "DELETE", employeeId: string, status?: string) {
    const label = employees.find((employee) => employee.id === employeeId)?.name ?? employeeId;
    if (method === "DELETE" && !window.confirm(`Delete ${label} from the employee directory? This cannot be undone.`)) return;
    setSavedId("");
    setMessage("");
    try {
      const response = await fetch("/api/employees", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, status }) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update employee.");
      setMessage(method === "DELETE" ? `${label} was deleted.` : `${label} is now ${status}.`);
      setBusy(true); setRevision((value) => value + 1);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to update employee."); }
  }
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = employees.filter((e) => terms.every((term) => `${e.name} ${e.id}`.toLowerCase().includes(term)) && (!branch || e.branch === branch || e.branchIds.some((id) => branches.find((item) => item.id === id)?.name === branch)) && (!role || e.roles.includes(role)) && (!status || e.status === status))
    .sort((a, b) => (a[sort].localeCompare(b[sort], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (descending ? -1 : 1));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages);
  const territories = [...new Set(branches.map((item) => item.territory || "Other"))];
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Employees</h1><p className="text-sm text-muted-foreground">Staff directory with branch assignments and operational roles.</p></div><div className="flex gap-2">{canRegister && <Button type="button" onClick={() => setShowForm(true)}>Add Employee</Button>}<Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); setEmployees([]); setRevision((v) => v + 1); }}>Refresh</Button></div></div>
    {canRegister && showForm && <form className="space-y-3 rounded-xl border bg-background p-4" onSubmit={async (event) => {
      event.preventDefault(); const form = event.currentTarget; setSaving(true); setMessage("");
      try {
        const response = await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), roles: selectedRoles, branchIds: selectedBranchIds, primaryBranchId: registerPrimaryId }) });
        const result = await readApiResponse(response); if (!response.ok || !result.success) throw new Error(result.message || "Unable to register employee.");
        form.reset(); setSelectedRoles([]); setSelectedBranchIds([]); setIssued(result.account?.oneTimePassword ? { employeeId: result.employee.id, fullName: result.employee.name, oneTimePassword: result.account.oneTimePassword, expiresAt: result.account.expiresAt } : null); setMessage(!result.account?.created ? `Employee ${result.employee.id} registered. ${result.account?.reason ?? ""}` : result.account.oneTimePassword ? `Employee ${result.employee.id} registered with a sign-in account.` : `Employee ${result.employee.id} registered with a sign-in account. Ask IT to issue their one-time password from User Accounts → Reset password.`); setSelectedPrimaryId(""); setShowForm(false); setBusy(true); setRevision((v) => v + 1);
      } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to register employee."); }
      finally { setSaving(false); }
    }}><h2 className="font-semibold">Register employee</h2><fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Employee ID<input name="employeeId" required pattern="[A-Za-z]{2,5}-[0-9]{4}-[0-9]{4}" placeholder="MD-20##-####" value={newEmployeeId} onChange={(event) => setNewEmployeeId(event.target.value.toUpperCase())} className={`${fieldClass} font-mono`}/><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{newEmployeeId === suggestedEmployeeId ? "Assigned automatically. You can edit it." : <>Edited. <button type="button" className="font-medium text-primary underline" onClick={() => setNewEmployeeId(suggestedEmployeeId)}>Use {suggestedEmployeeId}</button></>}</span></label>
      <label className="text-sm">Full name<input name="name" required maxLength={150} className={fieldClass}/></label>
      <fieldset className="space-y-3 rounded-md border p-3 sm:col-span-2 lg:col-span-3"><legend className="px-1 text-sm">Branch assignments *</legend><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelectedBranchIds(branches.map((item) => item.id))}>Select all</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedBranchIds([])}>Clear</Button>{territories.map((territory) => { const ids = branches.filter((item) => (item.territory || "Other") === territory).map((item) => item.id); const selected = ids.every((id) => selectedBranchIds.includes(id)); return <Button key={territory} type="button" size="sm" variant="outline" onClick={() => setSelectedBranchIds((current) => selected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])])}>{selected ? "Clear" : "Select"} {territory}</Button>; })}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{branches.map((item) => <label key={`${item.id}-${item.name}`} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedBranchIds.includes(item.id)} onChange={() => setSelectedBranchIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}/><span>{item.name}<span className="block text-xs text-muted-foreground">{item.territory}</span></span></label>)}</div></fieldset>
      <label className="text-sm sm:col-span-2 lg:col-span-3">Primary branch *<SearchSelect aria-label="Primary branch" className="mt-1 h-9" placeholder={selectedBranchIds.length ? "Search the ticked branches" : "Tick at least one branch first"} disabled={!selectedBranchIds.length} value={registerPrimaryId} onValueChange={setSelectedPrimaryId} options={branches.filter((item) => selectedBranchIds.includes(item.id)).map((item) => ({ value: item.id, label: item.name, description: item.territory }))}/><span className="mt-1 block text-xs text-muted-foreground">Where they clock in and the branch shown first. Must be one of the ticked branches.</span></label><fieldset className="space-y-2 rounded-md border p-3 sm:col-span-2 lg:col-span-3"><legend className="px-1 text-sm">Operational roles *</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{operationalRoles.map((item) => <label key={item} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedRoles.includes(item)} onChange={() => setSelectedRoles((current) => current.includes(item) ? current.filter((roleName) => roleName !== item) : [...current, item])}/>{item}</label>)}</div></fieldset>
      <label className="text-sm">Contact number<input name="contact" maxLength={50} className={fieldClass}/></label>
      <label className="text-sm">Email<input name="email" type="email" maxLength={254} className={fieldClass}/></label>
      <label className="text-sm">Date hired<input name="dateHired" type="date" className={fieldClass}/></label>
      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Register employee"}</Button>
    </fieldset><p role="status" className="text-sm">{message}</p></form>}
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search<input className={fieldClass} placeholder="Employee name or ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
      {[
        { label: "Branch", value: branch, options: unique(branches.map((item) => item.name)), set: setBranch },
        { label: "Operational role", value: role, options: unique(employees.flatMap((e) => e.roles)), set: setRole },
        { label: "Employment status", value: status, options: unique(employees.map((e) => e.status)), set: setStatus },
      ].map((filter) => filter.label === "Branch" ? <label key={filter.label} className="text-sm">{filter.label}<SearchSelect aria-label={filter.label} className="mt-1 h-9" clearable placeholder="All" value={filter.value} onValueChange={(value) => { filter.set(value); setPage(1); }} options={filter.options.map((v) => ({ value: v, label: v }))}/></label> : <label key={filter.label} className="text-sm">{filter.label}<select className={fieldClass} value={filter.value} onChange={(e) => { filter.set(e.target.value); setPage(1); }}><option value="">All</option>{filter.options.map((v) => <option key={v}>{v}</option>)}</select></label>)}
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}>{[["name", "Employee name"], ["id", "Employee ID"], ["branch", "Branch"], ["status", "Employment status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setSearch(""); setBranch(""); setRole(""); setStatus(""); setPage(1); }}>Reset filters</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Employees are registered independently of login accounts. Their operational roles are automatically selected when an administrator creates their login.</p>
    {message && !showForm && !editing && !savedId && <p role="status" className="text-sm">{message}</p>}
    {issued && <OneTimePasswordNotice issued={issued} onDone={() => setIssued(null)} />}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {busy ? <p role="status">Loading employees...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{filtered.length} of {employees.length} employees</p>
      <div className="overflow-x-auto rounded-xl border bg-background"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["Employee ID", "Name", "Branches", "Employment status", "Actions"].map((label) => <th scope="col" className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{filtered.slice((currentPage - 1) * 25, currentPage * 25).map((employee) => { const isExpanded = expandedEmployeeId === employee.id; const assignedNames = employee.branchIds.map((id) => branches.find((item) => item.id === id)?.name).filter((name): name is string => Boolean(name)); const branchNames = [employee.branch, ...assignedNames.filter((name) => name !== employee.branch)].filter(Boolean); return <Fragment key={employee.id}><tr className="border-t"><td className="p-3">{employee.id}</td><td className="p-3 font-medium"><button className="hover:underline" onClick={() => toggleEmployee(employee.id)}>{employee.name}</button></td><td className="p-3">{branchNames.length ? <><strong>{branchNames[0]}</strong> <span className="text-xs text-muted-foreground">(primary)</span>{branchNames.length > 1 && <span className="block text-xs text-muted-foreground">+ {branchNames.slice(1, 3).join(", ")}{branchNames.length > 3 ? ` and ${branchNames.length - 3} more` : ""}</span>}</> : "Not recorded"}</td><td className="p-3">{employee.status ? <StatusBadge status={employee.status}/> : "Not recorded"}</td><td className="p-3"><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => toggleEmployee(employee.id)}>{isExpanded ? <ChevronUp className="mr-2 size-4"/> : <ChevronDown className="mr-2 size-4"/>}{isExpanded ? "Collapse" : "View"}</Button>{canManage && <Button type="button" variant={editing?.id === employee.id ? "default" : "outline"} aria-expanded={editing?.id === employee.id} onClick={() => { setMessage(""); setSavedId(""); setEditing((current) => current?.id === employee.id ? null : employee); }}>{editing?.id === employee.id ? "Editing" : "Edit"}</Button>}{canManage && <Button type="button" variant="outline" className="text-destructive" onClick={() => void changeEmployee("DELETE", employee.id)}><Trash2 className="mr-2 size-4"/>Delete</Button>}</div></td></tr>{isExpanded && <tr className="border-t bg-muted/20"><td colSpan={5} className="p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-muted-foreground">Assigned branches</p><p>{branchNames.join(", ") || employee.branch || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Operational roles</p><p>{employee.roles.join(", ") || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Sign-in account</p><p>{employee.hasAccount ? employee.roleIds.join(", ") || "Account without roles" : "No sign-in account"}</p></div><div><p className="text-xs text-muted-foreground">Contact</p><p>{employee.contact || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Email</p><p>{employee.email || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Date hired</p><p>{employee.dateHired || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Registered</p><p>{employee.createdAt || "Not recorded"}</p></div></div></td></tr>}{savedId === employee.id && !editing && message && <tr><td colSpan={5} className="px-3 pb-3"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p></td></tr>}{canManage && editing?.id === employee.id && <InlineRow colSpan={5}><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setMessage(""); try { const data = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch("/api/employees", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, employeeId: editing.id, roles: editing.roles, branchIds: editing.branchIds, primaryBranchId: editing.branchIds.includes(editing.primaryBranchId) ? editing.primaryBranchId : editing.branchIds[0] ?? "" }) }); const result = await readApiResponse(response); if (!response.ok || !result.success) throw new Error(result.message || "Unable to update employee."); setEditing(null); setSavedId(String(data.newEmployeeId || editing.id).trim().toUpperCase()); setMessage(`${editing.name} was updated.${result.accountNote ? ` ${result.accountNote}` : ""}`); setBusy(true); setRevision((value) => value + 1); } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to update employee."); } finally { setSaving(false); } }}><div className="flex items-center justify-between"><div><h2 className="font-semibold">Edit {editing.name}</h2><p className="text-xs text-muted-foreground">Account Role ID: {editing.roleIds.join(", ") || "No login account"}</p></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-sm">Employee ID<input name="newEmployeeId" required className={`${fieldClass} uppercase`} defaultValue={editing.id} readOnly={!canChangeId} pattern="[A-Za-z]{2,5}-[0-9]{4}-[0-9]{4}" title="Company format, e.g. MD-2026-0001"/><span className="mt-1 block text-xs text-muted-foreground">{canChangeId ? "Changing it updates every record that uses it (accounts, attendance, sales, collections, payroll…). It is also their sign-in ID." : "Only an administrator can change the Employee ID."}</span></label>{canChangeId && <label className="text-sm">Reason for an ID change<input name="idReason" className={fieldClass} placeholder="e.g. Real Employee ID assigned"/></label>}<label className="text-sm">Full name<input name="name" required className={fieldClass} defaultValue={editing.name}/></label><label className="text-sm">Status<select name="status" className={fieldClass} defaultValue={editing.status}>{["active", "inactive", "resigned"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm">Contact<input name="contact" className={fieldClass} defaultValue={editing.contact}/></label><label className="text-sm">Email<input name="email" type="email" className={fieldClass} defaultValue={editing.email}/></label><label className="text-sm">Date hired<input name="dateHired" type="date" className={fieldClass} defaultValue={editing.dateHired}/></label></div><fieldset className="rounded-md border p-3"><legend className="px-1 text-sm">Branches</legend><div className="mb-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setEditing((current) => current ? { ...current, branchIds: branches.map((item) => item.id) } : current)}>Select all</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing((current) => current ? { ...current, branchIds: [] } : current)}>Clear</Button>{territories.map((territory) => { const ids = branches.filter((item) => (item.territory || "Other") === territory).map((item) => item.id); const selected = ids.every((id) => editing.branchIds.includes(id)); return <Button key={territory} type="button" size="sm" variant="outline" onClick={() => setEditing((current) => current ? { ...current, branchIds: selected ? current.branchIds.filter((id) => !ids.includes(id)) : [...new Set([...current.branchIds, ...ids])] } : current)}>{selected ? "Clear" : "Select"} {territory}</Button>; })}</div><div className="grid gap-2 sm:grid-cols-3">{branches.map((item) => <label key={`${item.id}-${item.name}`} className="flex gap-2 text-sm"><input type="checkbox" checked={editing.branchIds.includes(item.id)} onChange={() => setEditing((current) => current ? { ...current, branchIds: current.branchIds.includes(item.id) ? current.branchIds.filter((id) => id !== item.id) : [...current.branchIds, item.id] } : current)}/>{item.name}</label>)}</div></fieldset><label className="block text-sm">Primary branch *<SearchSelect aria-label="Primary branch" className="mt-1 h-9" placeholder={editing.branchIds.length ? "Search the ticked branches" : "Tick at least one branch first"} disabled={!editing.branchIds.length} value={editing.branchIds.includes(editing.primaryBranchId) ? editing.primaryBranchId : editing.branchIds[0] ?? ""} onValueChange={(value) => setEditing((current) => current ? { ...current, primaryBranchId: value } : current)} options={branches.filter((item) => editing.branchIds.includes(item.id)).map((item) => ({ value: item.id, label: item.name, description: item.territory }))}/><span className="mt-1 block text-xs text-muted-foreground">Where they clock in and the branch shown first.</span></label><fieldset className="rounded-md border p-3"><legend className="px-1 text-sm">Operational roles</legend><div className="grid gap-2 sm:grid-cols-3">{operationalRoles.map((item) => <label key={item} className="flex gap-2 text-sm"><input type="checkbox" checked={editing.roles.includes(item)} onChange={() => setEditing((current) => current ? { ...current, roles: current.roles.includes(item) ? current.roles.filter((roleName) => roleName !== item) : [...current.roles, item] } : current)}/>{item}</label>)}</div></fieldset><div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save employee"}</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>{message && <p role="status" className="text-sm">{message}</p>}</form></InlineRow>}</Fragment>; })}{!filtered.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{employees.length ? "No employees match these filters." : "No employees recorded yet."}</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button type="button" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
    </>}
  </section>;
}
