"use client";

import {
  Fragment,
  useEffect,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { readApiResponse } from "@/lib/api-response";
import { Button } from "@/components/ui/button";

type Employee = { id: string; name: string; status: string; branch: string; roles: string[]; createdAt: string; contact: string; email: string; dateHired: string };
const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

export default function EmployeesPage() {
  const [canRegister, setCanRegister] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
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
  const [expandedEmployees, setExpandedEmployees] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/employees", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load employees.");
      setEmployees(result.employees); setCanRegister(result.canRegister);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load employees."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision]);
  const toggleEmployee = (employeeId: string) => {
    setExpandedEmployees((current) => ({
      ...current,
      [employeeId]: !current[employeeId],
    }));
  };
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = employees.filter((e) => terms.every((term) => `${e.name} ${e.id}`.toLowerCase().includes(term)) && (!branch || e.branch === branch) && (!role || e.roles.includes(role)) && (!status || e.status === status))
    .sort((a, b) => (a[sort].localeCompare(b[sort], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (descending ? -1 : 1));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages);
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Employees</h1><p className="text-sm text-muted-foreground">Staff directory with branch assignments and operational roles.</p></div><div className="flex gap-2">{canRegister && <Button type="button" onClick={() => setShowForm(true)}>Add Employee</Button>}<Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); setEmployees([]); setRevision((v) => v + 1); }}>Refresh</Button></div></div>
    {canRegister && showForm && <form className="space-y-3 rounded-xl border bg-background p-4" onSubmit={async (event) => {
      event.preventDefault(); const form = event.currentTarget; setSaving(true); setMessage("");
      try {
        const response = await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        const result = await readApiResponse(response); if (!response.ok || !result.success) throw new Error(result.message || "Unable to register employee.");
        form.reset(); setMessage(`Employee ${result.employee.id} registered.`); setShowForm(false); setBusy(true); setRevision((v) => v + 1);
      } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to register employee."); }
      finally { setSaving(false); }
    }}><h2 className="font-semibold">Register employee</h2><fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Full name<input name="name" required maxLength={150} className={fieldClass}/></label>
      <label className="text-sm">Branch<input name="branch" required maxLength={150} className={fieldClass}/></label>
      <label className="text-sm">Operational role<select name="role" required className={fieldClass}><option value="">Select role</option>{["MAS", "Collector", "Entry Clerk", "IT Clerk", "Admin", "HR", "CEO"].map((r) => <option key={r}>{r}</option>)}</select></label>
      <label className="text-sm">Contact number<input name="contact" maxLength={50} className={fieldClass}/></label>
      <label className="text-sm">Email<input name="email" type="email" maxLength={254} className={fieldClass}/></label>
      <label className="text-sm">Date hired<input name="dateHired" type="date" className={fieldClass}/></label>
      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Register employee"}</Button>
    </fieldset><p role="status" className="text-sm">{message}</p></form>}
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search<input className={fieldClass} placeholder="Employee name or ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
      {[
        { label: "Branch", value: branch, options: unique(employees.map((e) => e.branch)), set: setBranch },
        { label: "Operational role", value: role, options: unique(employees.flatMap((e) => e.roles)), set: setRole },
        { label: "Employment status", value: status, options: unique(employees.map((e) => e.status)), set: setStatus },
      ].map((filter) => <label key={filter.label} className="text-sm">{filter.label}<select className={fieldClass} value={filter.value} onChange={(e) => { filter.set(e.target.value); setPage(1); }}><option value="">All</option>{filter.options.map((v) => <option key={v}>{v}</option>)}</select></label>)}
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}>{[["name", "Employee name"], ["id", "Employee ID"], ["branch", "Branch"], ["status", "Employment status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setSearch(""); setBranch(""); setRole(""); setStatus(""); setPage(1); }}>Reset filters</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Employees are registered independently of login accounts. Login access is managed in User Accounts.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {busy ? <p role="status">Loading employees...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{filtered.length} of {employees.length} employees</p>
      <div className="overflow-x-auto rounded-xl border bg-background"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["Employee ID", "Name", "Branch", "Employment status", "Details"].map((label) => <th scope="col" className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{filtered.slice((currentPage - 1) * 25, currentPage * 25).map((employee) => { const isExpanded = expandedEmployees[employee.id] ?? false; return <Fragment key={employee.id}><tr className="border-t"><td className="p-3">{employee.id}</td><td className="p-3 font-medium">{employee.name}</td><td className="p-3">{employee.branch || "Not recorded"}</td><td className="p-3">{employee.status || "Not recorded"}</td><td className="p-3"><Button type="button" variant="outline" aria-expanded={isExpanded} onClick={() => toggleEmployee(employee.id)}>{isExpanded ? <ChevronUp className="mr-2 size-4" /> : <ChevronDown className="mr-2 size-4" />}{isExpanded ? "Collapse" : "Expand"}</Button></td></tr>{isExpanded && <tr className="border-t bg-muted/20"><td colSpan={5} className="p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-muted-foreground">Operational roles</p><p>{employee.roles.join(", ") || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Contact</p><p>{employee.contact || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Email</p><p>{employee.email || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Date hired</p><p>{employee.dateHired || "Not recorded"}</p></div><div><p className="text-xs text-muted-foreground">Registered</p><p>{employee.createdAt || "Not recorded"}</p></div></div></td></tr>}</Fragment>; })}{!filtered.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{employees.length ? "No employees match these filters." : "No employees recorded yet."}</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
    </>}
  </section>;
}
