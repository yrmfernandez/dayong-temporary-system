"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CalendarRange, Calculator, FileText, MinusCircle, PlusCircle, Printer, Users, Wallet } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dailyRateOf, defaultPayrollSettings, lineTotals, type Adjustment, type PayProfile, type PayrollLine, type PayrollSettings } from "@/lib/payroll-calc";

type Run = { id: string; periodFrom: string; periodTo: string; payDate: string; status: string; settings: PayrollSettings; employeeCount: number; grossTotal: number; deductionsTotal: number; netTotal: number; preparedByUserId: string; preparedByName: string; approvedByName: string; approvedAt: string; paidAt: string; cashAccount: string; paymentReference: string; cashTransactionId: string; branch: string; voidReason: string; remarks: string };
type Overview = { canManage: boolean; runs: Run[]; profiles: PayProfile[]; employees: Array<{ id: string; name: string; roles: string[] }>; cashAccounts: string[]; branches: string[]; adjustmentCategories: string[] };
type Detail = { canManage: boolean; isAdministrator: boolean; currentUserId: string; run: Run; lines: PayrollLine[]; adjustments: Array<Adjustment & { status: string }>; totals: { gross: number; deductions: number; net: number } };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
function currentHalfMonth() {
  const date = today(), [year, month, day] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return Number(day) <= 15 ? { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-15` } : { from: `${year}-${pad(month)}-16`, to: `${year}-${pad(month)}-${pad(last)}` };
}

const settingOptions: Array<{ key: keyof PayrollSettings; label: string; hint: string }> = [
  { key: "includeOvertime", label: "Pay overtime", hint: "Overtime hours × hourly rate × multiplier" },
  { key: "deductLate", label: "Deduct late", hint: "Late minutes × per-minute rate" },
  { key: "deductUndertime", label: "Deduct undertime", hint: "Undertime minutes × per-minute rate" },
  { key: "payApprovedLeave", label: "Pay approved leave", hint: "Approved leave days count as paid days" },
  { key: "deductAbsences", label: "Deduct absences", hint: "Scheduled method: recorded Absent/AWOL and unpaid leave" },
  { key: "includeCommissions", label: "Include commissions", hint: "Pending Commissions records (net of Fidelity)" },
];

async function api<T>(body?: Record<string, unknown>, runId?: string): Promise<T> {
  const response = body
    ? await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    : await fetch(`/api/payroll${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || "Payroll request failed.");
  return result;
}

export default function PayrollPage() {
  const [tab, setTab] = useState<"runs" | "rates">("runs");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => setOverview(await api<Overview>()), []);
  const openRun = useCallback(async (runId: string) => { setDetail(await api<Detail>(undefined, runId)); }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOverview().catch((failure) => setError(failure instanceof Error ? failure.message : "Unable to load payroll."));
  }, [loadOverview]);

  async function act(body: Record<string, unknown>, success: string, after?: (result: Record<string, unknown>) => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<Record<string, unknown>>(body);
      const missing = Array.isArray(result.missingProfiles) && result.missingProfiles.length ? ` Not included (no pay setup): ${(result.missingProfiles as string[]).join(", ")}.` : "";
      setMessage(success + missing);
      await loadOverview();
      if (after) await after(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Payroll request failed."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6">
    <header className="page-hero">
      <div className="flex flex-wrap items-center gap-4">
        <div className="tone-soft tone-brand rounded-2xl p-3"><Banknote className="size-8" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">Finance</p>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pay employees from their base rate, attendance, commissions, and approved adjustments. Draft → Approved → Paid, with every change recorded.</p>
        </div>
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

    <div className="flex gap-1 border-b" role="tablist">
      {([["runs", "Payroll runs", CalendarRange], ["rates", "Pay rates", Users]] as const).map(([value, label, Icon]) => (
        <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setDetail(null); }}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Icon className="size-4" />{label}
        </button>
      ))}
    </div>

    {!overview && !error && <p className="text-sm text-muted-foreground">Loading payroll...</p>}
    {overview && tab === "runs" && !detail && <RunsList overview={overview} busy={busy} onOpen={(id) => void openRun(id).catch((failure) => setError(failure.message))}
      onCreate={(body) => act({ action: "create", ...body }, "Payroll draft created.", async (result) => { await openRun(String(result.id)); })} />}
    {overview && tab === "runs" && detail && <RunDetail overview={overview} detail={detail} busy={busy} onBack={() => setDetail(null)}
      act={(body, success) => act({ runId: detail.run.id, ...body }, success, async () => { await openRun(detail.run.id); })} />}
    {overview && tab === "rates" && <PayRates overview={overview} busy={busy} onSave={(body) => act({ action: "saveProfile", ...body }, "Pay setup saved.")} />}
  </section>;
}

function SettingsFields({ settings, onChange, disabled }: { settings: PayrollSettings; onChange: (next: PayrollSettings) => void; disabled?: boolean }) {
  return <div className="space-y-3">
    <div className="space-y-2">
      <Label>Base pay method</Label>
      <div role="radiogroup" aria-label="Base pay method" className="grid gap-1 rounded-lg border bg-muted/50 p-1 sm:grid-cols-2">
        {([["attendance", "Days present × daily rate"], ["scheduled", "Scheduled working days (Mon–Sat)"]] as const).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={settings.baseMethod === value} disabled={disabled} onClick={() => onChange({ ...settings, baseMethod: value })}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${settings.baseMethod === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {settingOptions.map((option) => {
        const inactive = option.key === "deductAbsences" && settings.baseMethod !== "scheduled";
        return <label key={option.key} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${inactive ? "opacity-50" : ""}`}>
          <input type="checkbox" className="mt-0.5" disabled={disabled || inactive} checked={Boolean(settings[option.key])} onChange={(event) => onChange({ ...settings, [option.key]: event.target.checked })} />
          <span><strong>{option.label}</strong><span className="block text-xs text-muted-foreground">{option.hint}</span></span>
        </label>;
      })}
    </div>
  </div>;
}

function RunsList({ overview, busy, onOpen, onCreate }: { overview: Overview; busy: boolean; onOpen: (id: string) => void; onCreate: (body: Record<string, unknown>) => Promise<void> }) {
  const half = currentHalfMonth();
  const [form, setForm] = useState({ periodFrom: half.from, periodTo: half.to, payDate: "", remarks: "" });
  const [settings, setSettings] = useState<PayrollSettings>(defaultPayrollSettings);
  const [showForm, setShowForm] = useState(false);
  const unpaid = overview.runs.filter((run) => run.status === "Approved");
  const setupCount = overview.profiles.filter((profile) => profile.status === "active").length;

  async function submit(event: FormEvent) { event.preventDefault(); await onCreate({ ...form, settings }); setShowForm(false); }

  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricTile tone="brand" icon={Users} label="Employees with pay setup" value={`${setupCount} / ${overview.employees.length}`} detail="Active employees" />
      <MetricTile tone="warning" icon={FileText} label="Drafts" value={String(overview.runs.filter((run) => run.status === "Draft").length)} detail="Awaiting approval" />
      <MetricTile tone="info" icon={Wallet} label="Approved, unpaid" value={money(unpaid.reduce((sum, run) => sum + run.netTotal, 0))} detail={`${unpaid.length} payroll run(s)`} />
      <MetricTile tone="success" icon={Banknote} label="Paid this year" value={money(overview.runs.filter((run) => run.status === "Paid" && run.payDate.startsWith(today().slice(0, 4))).reduce((sum, run) => sum + run.netTotal, 0))} detail="Net pay released" />
    </div>

    {overview.canManage && <Card>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>New payroll</CardTitle>{!showForm && <Button type="button" onClick={() => setShowForm(true)}><PlusCircle className="size-4" />Prepare payroll</Button>}</div></CardHeader>
      {showForm && <CardContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="pay-from">Period from *</Label><Input id="pay-from" type="date" required value={form.periodFrom} onChange={(event) => setForm({ ...form, periodFrom: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pay-to">Period to *</Label><Input id="pay-to" type="date" required min={form.periodFrom} value={form.periodTo} onChange={(event) => setForm({ ...form, periodTo: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pay-date">Planned pay date</Label><Input id="pay-date" type="date" value={form.payDate} onChange={(event) => setForm({ ...form, payDate: event.target.value })} /></div>
          </div>
          <SettingsFields settings={settings} onChange={setSettings} />
          <div className="space-y-2"><Label htmlFor="pay-remarks">Remarks</Label><Input id="pay-remarks" maxLength={200} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></div>
          <div className="flex gap-2"><Button type="submit" disabled={busy}><Calculator className="size-4" />{busy ? "Calculating..." : "Calculate draft"}</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </form>
      </CardContent>}
    </Card>}

    <Card>
      <CardHeader><CardTitle>Payroll runs</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr>{["Payroll", "Period", "Pay date", "Employees", "Net pay", "Status", ""].map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead>
            <tbody>
              {overview.runs.map((run) => <tr key={run.id} className="border-t">
                <td className="p-3 font-mono text-xs">{run.id}</td>
                <td className="p-3">{run.periodFrom} to {run.periodTo}</td>
                <td className="p-3">{run.payDate || "—"}</td>
                <td className="p-3">{run.employeeCount}</td>
                <td className="p-3 font-semibold tabular-nums">{money(run.netTotal)}</td>
                <td className="p-3"><StatusBadge status={run.status} /></td>
                <td className="p-3 text-right"><Button type="button" size="sm" variant="outline" onClick={() => onOpen(run.id)}>Open</Button></td>
              </tr>)}
              {!overview.runs.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No payroll yet. Set up pay rates, then prepare the first payroll.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function RunDetail({ overview, detail, busy, onBack, act }: { overview: Overview; detail: Detail; busy: boolean; onBack: () => void; act: (body: Record<string, unknown>, success: string) => Promise<void> }) {
  const { run, lines, adjustments, totals } = detail;
  const draft = run.status === "Draft" && detail.canManage;
  const [settings, setSettings] = useState<PayrollSettings>(run.settings);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState({ kind: "Addition", category: overview.adjustmentCategories[0] ?? "Other", amount: "", reason: "" });
  const [payment, setPayment] = useState({ payDate: run.payDate || today(), cashAccount: overview.cashAccounts[0] ?? "", branch: overview.branches[0] ?? "", paymentReference: "" });
  const [payslip, setPayslip] = useState<PayrollLine | null>(null);
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(run.settings);
  const selfApproval = run.preparedByUserId === detail.currentUserId && !detail.isAdministrator;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Button type="button" variant="ghost" onClick={onBack}>← All payroll runs</Button></div>
      <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm">{run.id}</span><StatusBadge status={run.status} /></div>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricTile tone="brand" icon={CalendarRange} label="Pay period" value={`${run.periodFrom.slice(5)} – ${run.periodTo.slice(5)}`} detail={`${run.periodFrom.slice(0, 4)} · ${lines.length} employees`} />
      <MetricTile tone="teal" icon={PlusCircle} label="Gross earnings" value={money(totals.gross)} detail="Base, overtime, commission, additions" />
      <MetricTile tone="danger" icon={MinusCircle} label="Deductions" value={money(totals.deductions)} detail="Late, undertime, absences, deductions" />
      <MetricTile tone="success" icon={Banknote} label="Net pay" value={money(totals.net)} detail={run.status === "Paid" ? `Paid ${run.payDate} from ${run.cashAccount}` : "To be released"} />
    </div>

    <Card>
      <CardHeader><CardTitle>Calculation settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <SettingsFields settings={settings} onChange={setSettings} disabled={!draft} />
        {draft && <Button type="button" variant={settingsChanged ? "default" : "outline"} disabled={busy} onClick={() => void act({ action: "recalculate", settings }, "Payroll recalculated from the latest attendance, rates, and commissions.")}><Calculator className="size-4" />{settingsChanged ? "Apply and recalculate" : "Recalculate"}</Button>}
        {!draft && <p className="text-xs text-muted-foreground">Settings are locked once a payroll is approved.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Employees</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead><tr>{["Employee", "Base pay", "Overtime", "Late / Undertime", "Absences", "Commission", "Adjustments", "Net pay", ""].map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead>
            <tbody>
              {lines.map((line) => {
                const lineTotal = lineTotals(line, adjustments);
                return <tr key={line.employeeId} className="border-t align-top">
                  <td className="p-3"><strong>{line.employeeName}</strong><span className="block text-xs text-muted-foreground">{line.employeeId} · {line.roles || "—"}</span></td>
                  <td className="p-3 tabular-nums">{line.baseType === "none" ? <span className="text-muted-foreground">No base</span> : <>{money(line.basePay)}<span className="block text-xs text-muted-foreground">{line.daysPaid} day(s) × {money(line.dailyRate)}{line.leaveDays ? ` · ${line.leaveDays} leave` : ""}</span></>}</td>
                  <td className="p-3 tabular-nums">{money(line.overtimePay)}<span className="block text-xs text-muted-foreground">{line.overtimeHours} hr</span></td>
                  <td className="p-3 tabular-nums">−{money(line.lateDeduction + line.undertimeDeduction)}<span className="block text-xs text-muted-foreground">{line.lateMinutes} late · {line.undertimeMinutes} UT min</span></td>
                  <td className="p-3 tabular-nums">−{money(line.absenceDeduction)}<span className="block text-xs text-muted-foreground">{line.absentDays} day(s)</span></td>
                  <td className="p-3 tabular-nums">{money(line.commission)}{line.earnedIncentive > 0 && <span className="block text-xs text-muted-foreground" title="Incentive earned on remitted collections in this period, for reference">Earned ref. {money(line.earnedIncentive)}</span>}</td>
                  <td className="p-3 tabular-nums"><span className="text-brand-moss">+{money(lineTotal.additions)}</span><span className="block text-brand-red">−{money(lineTotal.adjustmentDeductions)}</span></td>
                  <td className="p-3 font-bold tabular-nums">{money(lineTotal.net)}{lineTotal.shortfall > 0 && <span className="block text-xs font-normal text-brand-red">Deductions exceed pay by {money(lineTotal.shortfall)}</span>}</td>
                  <td className="p-3"><div className="flex flex-col gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setPayslip(line)}><Printer className="size-3.5" />Payslip</Button>
                    {draft && <Button type="button" size="sm" variant="ghost" onClick={() => setAdjusting(line.employeeId)}>Adjust</Button>}
                  </div></td>
                </tr>;
              })}
              {!lines.length && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No employees in this payroll.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    {adjusting && draft && <Card>
      <CardHeader><CardTitle>Adjust pay: {lines.find((line) => line.employeeId === adjusting)?.employeeName}</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void act({ action: "addAdjustment", employeeId: adjusting, ...adjustment }, "Adjustment added.").then(() => { setAdjusting(null); setAdjustment({ ...adjustment, amount: "", reason: "" }); }); }}>
          <div className="space-y-2"><Label>Type</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={adjustment.kind} onChange={(event) => setAdjustment({ ...adjustment, kind: event.target.value })}><option value="Addition">Addition (+)</option><option value="Deduction">Deduction (−)</option></select></div>
          <div className="space-y-2"><Label>Category</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={adjustment.category} onChange={(event) => setAdjustment({ ...adjustment, category: event.target.value })}>{overview.adjustmentCategories.map((category) => <option key={category}>{category}</option>)}</select></div>
          <div className="space-y-2"><Label>Amount *</Label><Input type="number" min="0.01" step="0.01" required value={adjustment.amount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} /></div>
          <div className="space-y-2 lg:col-span-4"><Label>Reason *</Label><Input required minLength={3} maxLength={300} placeholder="e.g. Sales target reached for September; approved by the owner" value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} /></div>
          <div className="flex gap-2 lg:col-span-4"><Button type="submit" disabled={busy}>Add adjustment</Button><Button type="button" variant="ghost" onClick={() => setAdjusting(null)}>Cancel</Button></div>
        </form>
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle>Adjustments</CardTitle></CardHeader>
      <CardContent>
        <div className="divide-y rounded-lg border">
          {adjustments.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span><StatusBadge status={item.kind} tone={item.kind === "Addition" ? "success" : "danger"} /> <strong className="ml-1">{lines.find((line) => line.employeeId === item.employeeId)?.employeeName ?? item.employeeId}</strong> · {item.category}<span className="block text-xs text-muted-foreground">{item.reason}</span></span>
            <span className="flex items-center gap-3"><strong className="tabular-nums">{item.kind === "Addition" ? "+" : "−"}{money(item.amount)}</strong>{draft && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "removeAdjustment", adjustmentId: item.id }, "Adjustment removed.")}>Remove</Button>}</span>
          </div>)}
          {!adjustments.length && <p className="p-3 text-sm text-muted-foreground">No bonuses or deductions. Use Adjust on an employee to add one with a reason.</p>}
        </div>
      </CardContent>
    </Card>

    {detail.canManage && run.status !== "Paid" && run.status !== "Void" && <Card>
      <CardHeader><CardTitle>{run.status === "Draft" ? "Approve" : "Record payment"}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {run.status === "Draft" && <>
          <p className="text-sm text-muted-foreground">Prepared by {run.preparedByName}. Approving locks the amounts. {selfApproval ? "Another Finance user or an Administrator must approve a payroll you prepared." : ""}</p>
          <Button type="button" disabled={busy || selfApproval || !lines.length} onClick={() => void act({ action: "approve" }, "Payroll approved.")}>Approve payroll ({money(totals.net)})</Button>
        </>}
        {run.status === "Approved" && <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); if (window.confirm(`Record ${money(totals.net)} paid from ${payment.cashAccount}? This posts one payroll outflow to Cash Transactions and marks included commissions Paid.`)) void act({ action: "pay", ...payment }, "Payroll paid and posted to the cash ledger."); }}>
          <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">Approved by {run.approvedByName}. Recording payment posts one cash outflow and marks the included commissions Paid.</p>
          <div className="space-y-2"><Label>Pay date *</Label><Input type="date" required value={payment.payDate} onChange={(event) => setPayment({ ...payment, payDate: event.target.value })} /></div>
          <div className="space-y-2"><Label>Paid from *</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" required value={payment.cashAccount} onChange={(event) => setPayment({ ...payment, cashAccount: event.target.value })}>{overview.cashAccounts.map((account) => <option key={account}>{account}</option>)}</select></div>
          <div className="space-y-2"><Label>Branch charged *</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" required value={payment.branch} onChange={(event) => setPayment({ ...payment, branch: event.target.value })}>{overview.branches.map((branch) => <option key={branch}>{branch}</option>)}</select></div>
          <div className="space-y-2"><Label>Reference</Label><Input maxLength={100} placeholder="Bank batch / voucher no." value={payment.paymentReference} onChange={(event) => setPayment({ ...payment, paymentReference: event.target.value })} /></div>
          <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={busy}>Record payment ({money(totals.net)})</Button></div>
        </form>}
        <div className="border-t pt-4"><Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => { const reason = window.prompt("Reason for voiding this payroll (required):"); if (reason?.trim()) void act({ action: "void", reason }, "Payroll voided. Its commissions are available to a new payroll."); }}>Void payroll</Button></div>
      </CardContent>
    </Card>}

    {run.status === "Void" && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">Voided: {run.voidReason}</p>}
    {run.status === "Paid" && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Paid on {run.payDate} from {run.cashAccount}{run.paymentReference ? ` (ref ${run.paymentReference})` : ""}. Cash ledger entry {run.cashTransactionId || "—"}.</p>}

    {payslip && <Payslip run={run} line={payslip} adjustments={adjustments} onClose={() => setPayslip(null)} />}
  </div>;
}

function Payslip({ run, line, adjustments, onClose }: { run: Run; line: PayrollLine; adjustments: Adjustment[]; onClose: () => void }) {
  const totals = lineTotals(line, adjustments);
  const own = adjustments.filter((item) => item.employeeId === line.employeeId);
  const print = () => { document.documentElement.classList.add("print-payslip"); window.print(); document.documentElement.classList.remove("print-payslip"); };
  const rows: Array<[string, number, string?]> = [
    ["Base pay", line.basePay, line.baseType === "none" ? "No base pay" : `${line.daysPaid} day(s) × ${money(line.dailyRate)}`],
    ["Overtime", line.overtimePay, `${line.overtimeHours} hour(s)`],
    ["Commission", line.commission, line.commissionIds.join(", ")],
    ...own.filter((item) => item.kind === "Addition").map((item): [string, number, string] => [item.category, item.amount, item.reason]),
  ];
  const deductions: Array<[string, number, string?]> = [
    ["Late", line.lateDeduction, `${line.lateMinutes} minute(s)`],
    ["Undertime", line.undertimeDeduction, `${line.undertimeMinutes} minute(s)`],
    ["Absences", line.absenceDeduction, `${line.absentDays} day(s)`],
    ...own.filter((item) => item.kind === "Deduction").map((item): [string, number, string] => [item.category, item.amount, item.reason]),
  ];
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Payslip for ${line.employeeName}`} onClick={onClose}>
    <div className="payslip my-8 w-full max-w-2xl rounded-2xl bg-card p-6 text-card-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">D&apos; San Roque Dayong Providers, Inc.</p><h2 className="text-xl font-bold">Payslip</h2><p className="text-sm text-muted-foreground">{run.periodFrom} to {run.periodTo}{run.payDate ? ` · Paid ${run.payDate}` : ""} · {run.id}</p></div>
        <div className="text-right"><p className="font-semibold">{line.employeeName}</p><p className="text-sm text-muted-foreground">{line.employeeId}</p><p className="text-xs text-muted-foreground">{line.roles}</p></div>
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <PayslipSection title="Earnings" rows={rows} total={totals.gross} />
        <PayslipSection title="Deductions" rows={deductions} total={totals.deductions} negative />
      </div>
      <div className="mt-6 flex items-center justify-between rounded-xl border-2 border-primary/40 p-4"><span className="font-semibold">Net pay</span><span className="text-2xl font-bold tabular-nums">{money(totals.net)}</span></div>
      <div className="mt-6 grid grid-cols-2 gap-8 pt-8 text-center text-xs text-muted-foreground"><div className="border-t pt-2">Prepared by</div><div className="border-t pt-2">Received by</div></div>
      <div className="payslip-actions mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Close</Button><Button type="button" onClick={print}><Printer className="size-4" />Print</Button></div>
    </div>
  </div>;
}

function PayslipSection({ title, rows, total, negative = false }: { title: string; rows: Array<[string, number, string?]>; total: number; negative?: boolean }) {
  return <div>
    <p className="mb-2 text-sm font-semibold">{title}</p>
    <div className="space-y-1.5 text-sm">
      {rows.filter(([, amount]) => amount > 0).map(([label, amount, note], index) => <div key={`${label}-${index}`} className="flex justify-between gap-3"><span>{label}{note && <span className="block text-xs text-muted-foreground">{note}</span>}</span><span className="tabular-nums">{negative ? "−" : ""}{money(amount)}</span></div>)}
      {!rows.some(([, amount]) => amount > 0) && <p className="text-muted-foreground">None</p>}
      <div className="flex justify-between border-t pt-1.5 font-semibold"><span>Total</span><span className="tabular-nums">{negative ? "−" : ""}{money(total)}</span></div>
    </div>
  </div>;
}

function PayRates({ overview, busy, onSave }: { overview: Overview; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const profiles = useMemo(() => new Map(overview.profiles.map((profile) => [profile.employeeId, profile])), [overview.profiles]);
  const [editing, setEditing] = useState<(PayProfile & { employeeName: string }) | null>(null);
  const [search, setSearch] = useState("");
  const employees = overview.employees.filter((employee) => `${employee.name} ${employee.id} ${employee.roles.join(" ")}`.toLowerCase().includes(search.toLowerCase()));

  function edit(employee: Overview["employees"][number]) {
    const isMas = employee.roles.some((role) => role.trim().toLowerCase() === "mas");
    setEditing({ employeeName: employee.name, ...(profiles.get(employee.id) ?? { employeeId: employee.id, baseType: isMas ? "none" : "daily", baseRate: 0, commissionEligible: isMas, hoursPerDay: 8, overtimeMultiplier: 1.25, status: "active", notes: "" }) });
  }

  return <div className="space-y-6">
    {editing && overview.canManage && <Card>
      <CardHeader><CardTitle>Pay setup: {editing.employeeName}</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave({ ...editing }).then(() => setEditing(null)); }}>
          <div className="space-y-2">
            <Label>Base pay</Label>
            <div role="radiogroup" aria-label="Base pay" className="grid gap-1 rounded-lg border bg-muted/50 p-1 sm:grid-cols-3">
              {([["daily", "Daily rate"], ["monthly", "Monthly salary"], ["none", "No base (commission only)"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={editing.baseType === value} onClick={() => setEditing({ ...editing, baseType: value })}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${editing.baseType === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label>{editing.baseType === "monthly" ? "Monthly salary *" : "Daily rate *"}</Label><Input type="number" min="0" step="0.01" disabled={editing.baseType === "none"} required={editing.baseType !== "none"} value={editing.baseType === "none" ? "" : editing.baseRate || ""} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setEditing({ ...editing, baseRate: Number(event.target.value) })} />
              {editing.baseType === "monthly" && editing.baseRate > 0 && <p className="text-xs text-muted-foreground">≈ {money(dailyRateOf(editing))} per day (× 12 ÷ 313 working days)</p>}</div>
            <div className="space-y-2"><Label>Hours per day</Label><Input type="number" min="1" max="24" step="0.5" value={editing.hoursPerDay} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setEditing({ ...editing, hoursPerDay: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Overtime multiplier</Label><Input type="number" min="1" max="5" step="0.05" value={editing.overtimeMultiplier} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setEditing({ ...editing, overtimeMultiplier: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">1.25 = regular-day overtime</p></div>
            <div className="space-y-2"><Label>Status</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as PayProfile["status"] })}><option value="active">Active (include in payroll)</option><option value="inactive">Inactive</option></select></div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-0.5" checked={editing.commissionEligible} onChange={(event) => setEditing({ ...editing, commissionEligible: event.target.checked })} /><span><strong>Earns commissions</strong><span className="block text-xs text-muted-foreground">MAS and other sales roles: pending Commissions records (net of Fidelity) are added to their pay.</span></span></label>
          <div className="space-y-2"><Label>Notes</Label><Input maxLength={200} value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></div>
          <div className="flex gap-2"><Button type="submit" disabled={busy}>Save pay setup</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </form>
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Employee pay rates</CardTitle><Input className="max-w-xs" placeholder="Search employee or role" value={search} onChange={(event) => setSearch(event.target.value)} /></div></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr>{["Employee", "Roles", "Base pay", "Commission", "Overtime", "Status", ""].map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead>
            <tbody>
              {employees.map((employee) => {
                const profile = profiles.get(employee.id);
                return <tr key={employee.id} className="border-t">
                  <td className="p-3"><strong>{employee.name}</strong><span className="block text-xs text-muted-foreground">{employee.id}</span></td>
                  <td className="p-3">{employee.roles.join(", ") || "—"}</td>
                  <td className="p-3 tabular-nums">{!profile ? "—" : profile.baseType === "none" ? "No base" : `${money(profile.baseRate)} / ${profile.baseType === "monthly" ? "month" : "day"}`}</td>
                  <td className="p-3">{profile?.commissionEligible ? "Yes" : profile ? "No" : "—"}</td>
                  <td className="p-3">{profile ? `× ${profile.overtimeMultiplier}` : "—"}</td>
                  <td className="p-3">{profile ? <StatusBadge status={profile.status} /> : <StatusBadge status="Needs pay setup" tone="warning" />}</td>
                  <td className="p-3 text-right">{overview.canManage && <Button type="button" size="sm" variant="outline" onClick={() => edit(employee)}>{profile ? "Edit" : "Set up"}</Button>}</td>
                </tr>;
              })}
              {!employees.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No active employees match.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>;
}
