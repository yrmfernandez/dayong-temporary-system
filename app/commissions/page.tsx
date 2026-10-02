"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";

type Commission = { id: string; employeeId: string; employeeName: string; periodFrom: string; periodTo: string; grossIncentive: number; fidelityDeduction: number; netCommission: number; status: string; paidAt: string; referenceNumber: string; remarks: string };
type Earned = { employeeId: string; name: string; role: string; saleIncentives: number; collectionIncentives: number; sales: number; collections: number; grossIncentive: number; fidelity: number; netCommission: number; recorded: number };
type Form = { employeeId: string; employeeName: string; periodFrom: string; periodTo: string; grossIncentive: string; fidelityDeduction: string; referenceNumber: string; remarks: string };
const money = (v: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
// Quick periods, in Manila time.
function periodFor(preset: "this-month" | "last-month" | "this-year") {
  const now = today(), [year, month] = now.split("-").map(Number);
  if (preset === "this-year") return { from: `${year}-01-01`, to: now };
  if (preset === "this-month") return { from: `${now.slice(0, 7)}-01`, to: now };
  const last = new Date(Date.UTC(year, month - 1, 0));
  return { from: `${last.toISOString().slice(0, 7)}-01`, to: last.toISOString().slice(0, 10) };
}
type Filters = { search: string; employeeId: string; role: string; recorded: string; status: string };
const noFilters: Filters = { search: "", employeeId: "", role: "", recorded: "", status: "" };
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
// An earner's roles are listed comma-separated; a role filter matches any of them.
const roleList = (roles: string) => roles.split(",").map((role) => role.trim()).filter(Boolean);
const hasRole = (roles: string | undefined, role: string) => roleList(roles ?? "").includes(role);
const blank = (from: string, to: string): Form => ({ employeeId: "", employeeName: "", periodFrom: from, periodTo: to, grossIncentive: "", fidelityDeduction: "0", referenceNumber: "", remarks: "" });

/** Commissions for employees who earned them: incentives on New Sales and Collections. Fidelity is their own money and is not deducted. */
export default function CommissionsPage() {
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`), [to, setTo] = useState(today());
  const [rows, setRows] = useState<Commission[]>([]), [earned, setEarned] = useState<Earned[]>([]);
  const [form, setForm] = useState<Form>(() => blank(`${today().slice(0, 7)}-01`, today())), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/commissions?from=${from}&to=${to}`, { cache: "no-store" }), result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setRows(result.commissions ?? []); setEarned(result.earned ?? []);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load commissions."); }
    finally { setBusy(false); }
  }, [from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
  useEffect(() => { void load(); }, [load]);
  const earnerIds = useMemo(() => new Set(earned.map((x) => x.employeeId).filter(Boolean)), [earned]);
  const roleOf = useMemo(() => new Map(earned.map((x) => [x.employeeId, x.role])), [earned]);
  // Any employee with sales earns incentives, so the role filter offers whatever roles this period's earners hold.
  const roleOptions = useMemo(() => [...new Set(earned.flatMap((x) => roleList(x.role)))].sort((a, b) => Number(b === "MAS") - Number(a === "MAS") || a.localeCompare(b)), [earned]);
  const matchesText = useCallback((name: string, id: string) => { const term = filters.search.trim().toLowerCase(); return !term || name.toLowerCase().includes(term) || id.toLowerCase().includes(term); }, [filters.search]);
  const shownEarned = useMemo(() => earned.filter((x) => {
    const remaining = x.grossIncentive - x.recorded;
    const recorded = x.recorded <= 0 ? "none" : remaining > 0 ? "partial" : "full";
    return matchesText(x.name, x.employeeId) && (!filters.employeeId || x.employeeId === filters.employeeId) && (!filters.role || hasRole(x.role, filters.role)) && (!filters.recorded || filters.recorded === recorded);
  }), [earned, filters, matchesText]);
  // Only people with commission appear in the register: this period's earners and anyone with a recorded commission.
  const register = useMemo(() => rows.filter((x) => (earnerIds.has(x.employeeId) || x.grossIncentive > 0)
    && matchesText(x.employeeName, x.employeeId) && (!filters.employeeId || x.employeeId === filters.employeeId)
    && (!filters.role || hasRole(roleOf.get(x.employeeId), filters.role)) && (!filters.status || (filters.status === "Paid" ? x.status === "Paid" : x.status !== "Paid"))), [rows, earnerIds, roleOf, filters, matchesText]);
  const totals = useMemo(() => ({ earned: shownEarned.reduce((s, x) => s + x.netCommission, 0), pending: register.filter((x) => x.status !== "Paid").reduce((s, x) => s + x.netCommission, 0), paid: register.filter((x) => x.status === "Paid").reduce((s, x) => s + x.netCommission, 0), fidelity: shownEarned.reduce((s, x) => s + x.fidelity, 0) }), [shownEarned, register]);
  // Everyone with commission, for the employee dropdown: this period's earners first, then others in the register.
  const people = useMemo(() => {
    const options = new Map<string, { value: string; label: string; description: string }>();
    for (const x of earned) if (x.employeeId) options.set(x.employeeId, { value: x.employeeId, label: x.name, description: `${x.role} · ${x.employeeId}` });
    for (const x of rows) if (x.employeeId && !options.has(x.employeeId)) options.set(x.employeeId, { value: x.employeeId, label: x.employeeName, description: x.employeeId });
    return [...options.values()];
  }, [earned, rows]);
  const filtered = Object.values(filters).some(Boolean);

  function prefill(entry: Earned) {
    setForm({ employeeId: entry.employeeId, employeeName: entry.name, periodFrom: from, periodTo: to, grossIncentive: String(Math.max(0, Math.round((entry.grossIncentive - entry.recorded) * 100) / 100)), fidelityDeduction: "0", referenceNumber: "", remarks: `${entry.sales} new sales · ${entry.collections} collections` });
    setShow(true); setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch("/api/commissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, grossIncentive: Number(form.grossIncentive), fidelityDeduction: Number(form.fidelityDeduction) }) }), result = await response.json();
    if (!response.ok) { setError(result.message); return; }
    setShow(false); setForm(blank(from, to)); setMessage(`Commission ${result.id} recorded for payroll.`); await load();
  }
  async function pay(record: Commission) {
    const reference = window.prompt("Payment reference number:", record.referenceNumber) || "";
    const response = await fetch("/api/commissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, referenceNumber: reference }) }), result = await response.json();
    if (!response.ok) { setError(result.message); return; }
    setMessage("Commission marked paid."); await load();
  }

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl page-hero p-5"><div><span className="text-xs font-bold uppercase">Finance</span><h1 className="text-3xl font-black">Commissions</h1><p className="text-sm text-violet-30/80">Incentives earned on New Sales and Collections, less MAS Fidelity, recorded for payroll.</p></div>
      <div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field></div></header>
    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap gap-2">{([["this-month", "This month"], ["last-month", "Last month"], ["this-year", "This year"]] as const).map(([preset, label]) => { const period = periodFor(preset), active = period.from === from && period.to === to; return <Button key={preset} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => { setFrom(period.from); setTo(period.to); }}>{label}</Button>; })}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Search" placeholder="Search name or employee ID" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} />
        <SearchSelect aria-label="Employee" className="h-9" clearable placeholder="All employees" value={filters.employeeId} onValueChange={(value) => setFilter("employeeId", value)} options={people} />
        <select aria-label="Role" className={selectClass} value={filters.role} onChange={(e) => setFilter("role", e.target.value)}><option value="">All roles</option>{roleOptions.map((role) => <option key={role}>{role}</option>)}</select>
        <select aria-label="Recorded for payroll" className={selectClass} value={filters.recorded} onChange={(e) => setFilter("recorded", e.target.value)}><option value="">Any recording</option><option value="none">Not recorded</option><option value="partial">Partly recorded</option><option value="full">Fully recorded</option></select>
        <select aria-label="Payment status" className={selectClass} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}><option value="">Any payment status</option><option value="Pending">Pending</option><option value="Paid">Paid</option></select>
      </div>
      {filtered && <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Showing {shownEarned.length} of {earned.length} earners and {register.length} register entries.</span><button type="button" className="font-medium text-primary hover:underline" onClick={() => setFilters(noFilters)}>Clear filters</button></p>}
    </CardContent></Card>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="rounded-xl border p-3 text-sm">{message}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Earned this period", totals.earned], ["Fidelity given (not deducted)", totals.fidelity], ["Recorded, not yet paid", totals.pending], ["Paid", totals.paid]].map(([label, value]) => <Card key={String(label)}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{money(Number(value))}</p></CardContent></Card>)}</div>

    <Card><CardHeader><CardTitle>Earned Commissions</CardTitle><p className="text-xs text-muted-foreground">Every employee who earned an incentive from {from} to {to}: anyone with New Sales, plus MAS and Collectors on Collections. MAS first. Fidelity is what they added to their approved remittances from their own money; it is not deducted.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr>{["Employee", "Role", "New Sales", "Collections", "Gross incentive", "Fidelity given", "Net commission", "Recorded", ""].map((h) => <th key={h} className="border-b p-3 text-left">{h}</th>)}</tr></thead><tbody>
      {shownEarned.map((x) => { const remaining = Math.round((x.grossIncentive - x.recorded) * 100) / 100; return <tr key={x.name}><td className="border-b p-3"><b>{x.name}</b><br /><span className="text-xs text-muted-foreground">{x.employeeId || "No employee record"}</span></td><td className="border-b p-3">{x.role}</td><td className="border-b p-3 tabular-nums">{money(x.saleIncentives)}<span className="block text-xs text-muted-foreground">{x.sales} sales</span></td><td className="border-b p-3 tabular-nums">{money(x.collectionIncentives)}<span className="block text-xs text-muted-foreground">{x.collections} payments</span></td><td className="border-b p-3 tabular-nums">{money(x.grossIncentive)}</td><td className="border-b p-3 tabular-nums text-emerald-700">{x.fidelity > 0 ? `− ${money(x.fidelity)}` : "—"}</td><td className="border-b p-3 font-bold tabular-nums">{money(x.netCommission)}</td><td className="border-b p-3 text-xs">{x.recorded > 0 ? <>{money(x.recorded)}{remaining > 0 ? <span className="block text-amber-700">{money(remaining)} not recorded</span> : <span className="block text-emerald-700">Fully recorded</span>}</> : <span className="text-amber-700">Not recorded</span>}</td><td className="border-b p-3">{x.employeeId && remaining > 0 && <Button size="sm" onClick={() => prefill(x)}>Record for payroll</Button>}</td></tr>; })}
      {!shownEarned.length && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">{busy ? "Loading..." : earned.length ? "No earners match these filters." : "No one earned an incentive in this period."}</td></tr>}
    </tbody></table></div></CardContent></Card>

    {show && <Card><CardHeader><CardTitle>Record Commission</CardTitle><p className="text-xs text-muted-foreground">Prefilled from the earned incentives; payroll includes it for employees who earn commissions.</p></CardHeader><CardContent><form onSubmit={save} className="grid gap-4 md:grid-cols-3">
      <Field label="Employee"><SearchSelect aria-label="Employee" placeholder="Search commission earners" value={form.employeeId} options={earned.filter((x) => x.employeeId).map((x) => ({ value: x.employeeId, label: x.name, description: `${x.role} · ${x.employeeId}` }))} onValueChange={(value) => { const entry = earned.find((x) => x.employeeId === value); if (entry) prefill(entry); }} /></Field>
      <Field label="Period from"><Input type="date" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} /></Field>
      <Field label="Period to"><Input type="date" value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} /></Field>
      <Field label="Gross incentive"><Input type="number" min="0" step="0.01" value={form.grossIncentive} onChange={(e) => setForm({ ...form, grossIncentive: e.target.value })} /></Field>
      <Field label="Deduction (old Fidelity rule only)"><Input type="number" min="0" step="0.01" value={form.fidelityDeduction} onChange={(e) => setForm({ ...form, fidelityDeduction: e.target.value })} /></Field>
      <Field label="Net commission"><Input readOnly className="bg-muted/50" value={money((Number(form.grossIncentive) || 0) - (Number(form.fidelityDeduction) || 0))} /></Field>
      <Field label="Reference"><Input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} /></Field>
      <div className="md:col-span-2"><Field label="Remarks"><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field></div>
      <div className="flex gap-2 md:col-span-3"><Button type="submit" disabled={busy || !form.employeeId}>Record Commission</Button><Button type="button" variant="ghost" onClick={() => setShow(false)}>Cancel</Button></div>
    </form></CardContent></Card>}

    <Card><CardHeader><CardTitle>Commission Register</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr>{["Period", "Employee", "Gross", "Fidelity", "Net", "Status", "Paid at", "Action"].map((x) => <th className="border-b p-3 text-left" key={x}>{x}</th>)}</tr></thead><tbody>
      {register.map((x) => <tr key={x.id}><td className="border-b p-3">{x.periodFrom} – {x.periodTo}</td><td className="border-b p-3"><b>{x.employeeName}</b><br />{x.employeeId}</td><td className="border-b p-3 tabular-nums">{money(x.grossIncentive)}</td><td className="border-b p-3 tabular-nums">{x.fidelityDeduction > 0 ? `− ${money(x.fidelityDeduction)}` : "—"}</td><td className="border-b p-3 font-bold tabular-nums">{money(x.netCommission)}</td><td className="border-b p-3">{x.status}</td><td className="border-b p-3">{x.paidAt || "—"}</td><td className="border-b p-3">{x.status !== "Paid" && <Button size="sm" onClick={() => void pay(x)}>Mark paid</Button>}</td></tr>)}
      {!register.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{filtered && rows.length ? "No recorded commissions match these filters." : "No commissions recorded yet."}</td></tr>}
    </tbody></table></div></CardContent></Card>
  </section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
