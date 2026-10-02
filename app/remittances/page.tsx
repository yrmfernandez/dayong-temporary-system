"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileCheck2, LayoutDashboard, Plus, RefreshCw, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { parseJsonResponse } from "@/lib/api-response";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";

type Kind = "Collections" | "New Sales";
type Collection = { kind: Kind; id: string; batchId: string; memberNumber: string; programId: string; branch: string; accountableEmployeeId: string; accountableName: string; accountableRole: string; orNumber: string; orDate: string; amount: number; remittanceAmount:number; remittanceStatus: string; daysOutstanding:number; collectedBy: string; paymentMethod: string; paymentReference: string; penalty: number; penaltyNote: string; fidelity: number };
type Remittance = { type: Kind; id: string; branch: string; accountableName: string; accountableEmployeeId:string; accountableRole:string; remittanceDate: string; status: string; submittedByName: string; expectedAmount: number; actualAmount: number; difference: number; fidelityAmount:number; collectionCount: number; receivedByName: string; decisionByName: string; decisionAt: string; remarks: string; decisionReason: string; collectionIds: string[]; paymentMethods: string[]; paymentReferences: string[]; penaltyAmount: number; penaltyNotes: string[] };
type Dashboard = {
  summary: { outstandingAmount: number; outstandingCount: number; pendingAmount: number; pendingCount: number; approvedTodayAmount: number; approvedTodayCount: number; discrepancyAmount: number; historicalReviewCount: number };
  accountability: Array<{ employeeId: string; name: string; role: string; branch: string; collectionCount: number; outstandingAmount: number }>;
  outstanding: Collection[];
  remittances: Remittance[];
};
type View = "dashboard" | "new" | "approval" | "records" | "reports";

const views = [
  { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
  { id: "new" as const, label: "New Remittance", icon: Plus },
  { id: "approval" as const, label: "Pending Approval", icon: FileCheck2 },
  { id: "records" as const, label: "Remittance Records", icon: CheckCircle2 },
  { id: "reports" as const, label: "Reports", icon: BarChart3 },
];
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function RemittancesPage() {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  // Collections and New Sales are turned over on separate slips, so a new remittance covers one kind.
  const [kind, setKind] = useState<Kind>("Collections");
  const [selected, setSelected] = useState<string[]>([]);
  const [actualAmount, setActualAmount] = useState("");
  const [fidelityAmount, setFidelityAmount] = useState("0");
  const [remittanceDate, setRemittanceDate] = useState(today());
  const [receivedByName, setReceivedByName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportFrom, setReportFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(today);
  const [reportBranch, setReportBranch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/remittances", { cache: "no-store" });
      const result = await parseJsonResponse<Dashboard & { error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to load Remittances.");
      setData(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Remittances."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => { if (result.success && result.user?.name) setReceivedByName(result.user.name); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const ownerCollections = useMemo(() => data?.outstanding.filter((collection) => collection.kind === kind && `${collection.accountableEmployeeId}|${collection.accountableName}|${collection.branch}` === ownerKey) ?? [], [data, ownerKey, kind]);
  const selectedCollections = ownerCollections.filter((collection) => selected.includes(collection.id));
  // A penalty is charged to the accountable MAS/Collector and tracked separately from the remittance.
  const selectedPenalty = selectedCollections.reduce((sum, collection) => sum + (collection.penalty || 0), 0);
  // Fidelity entered while encoding the Collections batch is used as is; older batches may still enter it here.
  const encodedFidelity = selectedCollections.reduce((sum, collection) => sum + (collection.fidelity || 0), 0);
  const effectiveFidelity = encodedFidelity || Number(fidelityAmount || 0);
  // Fidelity is the employee's own money, so it is part of the cash expected.
  const expectedAmount = Math.round((selectedCollections.reduce((sum, collection) => sum + collection.remittanceAmount, 0) + effectiveFidelity) * 100) / 100;
  const pending = data?.remittances.filter((item) => ["Pending Approval", "Discrepancy"].includes(item.status)) ?? [];
  const records = data?.remittances.filter((item) => ["Approved", "Rejected"].includes(item.status)) ?? [];

  const createRemittance = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const fullCash = cashConfirmed && Math.round(expectedAmount * 100) === Math.round(Number(actualAmount) * 100);
      const response = await fetch("/api/remittances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionIds: selected, actualAmount: Number(actualAmount), fidelityAmount:encodedFidelity > 0 ? 0 : Number(fidelityAmount||0), remittanceDate, remarks, cashConfirmed: fullCash }) });
      const result = await parseJsonResponse<{ error?: string; remittance?: { id: string; status: string } }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to create Remittance.");
      const finalStatus = result.remittance?.status || "submitted";
      setMessage(`${result.remittance?.id} saved as ${finalStatus}.`);
      setSelected([]); setActualAmount(""); setFidelityAmount("0"); setRemarks(""); setCashConfirmed(false); setView(finalStatus === "Approved" ? "records" : "approval"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create Remittance."); }
    finally { setSaving(false); }
  };

  const decide = async (id: string, decision: "approve" | "reject", hasDiscrepancy = false) => {
    const reason = decision === "reject" ? window.prompt("Rejection reason (required):") : hasDiscrepancy ? window.prompt("Explain how this discrepancy was resolved (required):") : "";
    if ((decision === "reject" || hasDiscrepancy) && !reason?.trim()) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/remittances", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remittanceId: id, decision, reason }) });
      const result = await parseJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to update Remittance.");
      setMessage(`${id} ${decision === "approve" ? "approved" : "rejected"}.`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update Remittance."); }
    finally { setSaving(false); }
  };

  if (loading && !data) return <p className="p-6 text-sm text-muted-foreground">Loading cash accountability...</p>;

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 rounded-3xl page-hero p-5 sm:flex-row sm:items-start sm:justify-between">
        <div><span className="rounded-md bg-violet-95 px-2 py-1 text-violet-30 text-[11px] font-bold uppercase tracking-wider">Finance</span><h1 className="mt-2 text-3xl font-black tracking-tight">Remittance</h1><p className="text-sm text-violet-30/80">Physical cash turnover, verification, approval, and Collector/MAS accountability.</p></div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="warning" icon={Wallet} label="Outstanding Accountability" value={money(data?.summary.outstandingAmount ?? 0)} detail={`${data?.summary.outstandingCount ?? 0} Collections`} />
        <MetricTile tone="info" icon={Clock3} label="Pending Approval" value={money(data?.summary.pendingAmount ?? 0)} detail={`${data?.summary.pendingCount ?? 0} Remittances`} />
        <MetricTile tone="success" icon={CheckCircle2} label="Approved Today" value={money(data?.summary.approvedTodayAmount ?? 0)} detail={`${data?.summary.approvedTodayCount ?? 0} Remittances`} />
        <MetricTile tone={(data?.summary.discrepancyAmount ?? 0) ? "danger" : "teal"} icon={AlertTriangle} label="Discrepancies" value={money(data?.summary.discrepancyAmount ?? 0)} detail="Absolute shortage / overage" />
      </div>
      {(data?.summary.historicalReviewCount ?? 0) > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data?.summary.historicalReviewCount} historical Collections predate this approval workflow and require reconciliation before they affect accountability.</p>}

      <div className="overflow-x-auto border-b"><div className="flex min-w-max gap-1" role="tablist">{views.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${view === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" />{item.label}</button>; })}</div></div>

      {view === "dashboard" && <Card><CardHeader><CardTitle>Accountability by Collector / MAS</CardTitle></CardHeader><CardContent><DataTable headers={["Accountable person", "Role", "Branch", "Collections", "Outstanding"]} rows={(data?.accountability ?? []).map((row) => [row.name || row.employeeId || "Unassigned", row.role, row.branch, String(row.collectionCount), money(row.outstandingAmount)])} empty="No outstanding Collections." /></CardContent></Card>}

      {view === "new" && <Card><CardHeader><CardTitle>New Remittance</CardTitle><p className="text-sm text-muted-foreground">Collections and New Sales are remitted on separate slips. Choose which slip, the accountable person, then the exact items in the cash turnover.</p></CardHeader><CardContent className="space-y-5">
        <div role="radiogroup" aria-label="Remittance slip" className="grid max-w-md grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1">{(["Collections", "New Sales"] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => { setKind(option); setOwnerKey(""); setSelected([]); setActualAmount(""); setFidelityAmount("0"); }} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${kind === option ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{option} slip</button>)}</div>
        <div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label htmlFor="owner">Collector / MAS</Label><SearchSelect id="owner" className="h-9" placeholder="Search accountable person" value={ownerKey} onValueChange={(value) => { setOwnerKey(value); setSelected([]); setActualAmount(""); }} options={(data?.accountability ?? []).filter((owner) => data?.outstanding.some((collection) => collection.kind === kind && collection.accountableEmployeeId === owner.employeeId && collection.accountableName === owner.name && collection.branch === owner.branch)).map((owner) => ({ value: `${owner.employeeId}|${owner.name}|${owner.branch}`, label: owner.name || owner.employeeId, description: `${owner.employeeId} · ${owner.branch} · ${money(owner.outstandingAmount)}` }))}/></div><Field label="Turnover date"><Input type="date" value={remittanceDate} onChange={(event) => setRemittanceDate(event.target.value)} /></Field><Field label="Received by"><Input value={receivedByName} readOnly className="bg-muted/50" /></Field></div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-3">Select</th><th className="p-3">{kind === "New Sales" ? "New Sale" : "Collection"}</th><th className="p-3">Member</th><th className="p-3">Program</th><th className="p-3">{kind === "New Sales" ? "OR / App no. · Date" : "OR Date"}</th><th className="p-3">{kind === "New Sales" ? "MAS · Remittance method" : "Collected by · Remittance method"}</th><th className="p-3 text-right">{kind === "New Sales" ? "Amount paid" : "Collected"}</th><th className="p-3 text-right">Remittance</th></tr></thead><tbody>{ownerCollections.map((collection) => <tr key={collection.id} className="border-t"><td className="p-3"><input type="checkbox" checked={selected.includes(collection.id)} onChange={(event) => { const batchIds = collection.batchId ? ownerCollections.filter((item) => item.batchId === collection.batchId).map((item) => item.id) : [collection.id]; setSelected((current) => event.target.checked ? [...new Set([...current, ...batchIds])] : current.filter((id) => !batchIds.includes(id))); }} /></td><td className="p-3 font-mono text-xs">{collection.id}</td><td className="p-3">{collection.memberNumber}</td><td className="p-3">{collection.programId}</td><td className="p-3">{kind === "New Sales" && collection.orNumber && <span className="block text-xs text-muted-foreground">{collection.orNumber}</span>}{collection.orDate}</td><td className="p-3"><PaymentLabel by={collection.collectedBy} method={collection.paymentMethod} reference={collection.paymentReference} /></td><td className="p-3 text-right">{money(collection.amount)}</td><td className="p-3 text-right font-medium">{money(collection.remittanceAmount)}{collection.penalty > 0 && <span className="block text-xs font-semibold text-red-700">Penalty {money(collection.penalty)} (separate)<span className="block max-w-[16rem] font-normal">{collection.penaltyNote}</span></span>}{collection.fidelity > 0 && <span className="block text-xs font-semibold text-emerald-700">MAS Fidelity {money(collection.fidelity)} (separate)<span className="block font-normal">deducted from incentives</span></span>}</td></tr>)}{!ownerCollections.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Select an accountable person with outstanding Collections.</td></tr>}</tbody></table></div>
        <div className="grid gap-4 md:grid-cols-4"><MetricTile tone="brand" label={kind === "New Sales" ? "Selected New Sales" : "Selected Collections"} value={String(selected.length)} detail={`Expected ${money(expectedAmount)}${effectiveFidelity > 0 ? ` (incl. ${money(effectiveFidelity)} Fidelity)` : ""}${selectedPenalty > 0 ? ` · separate: ${money(selectedPenalty)} penalty` : ""}`} /><Field label="Actual amount received"><Input type="number" min="0" step="0.01" value={actualAmount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setActualAmount(event.target.value)} /></Field><Field label="Fidelity"><Input type="number" min="0" step="0.01" value={encodedFidelity > 0 ? String(encodedFidelity) : fidelityAmount} disabled={encodedFidelity > 0} onWheel={(event)=>event.currentTarget.blur()} onChange={(event)=>setFidelityAmount(event.target.value)}/><p className="text-xs text-muted-foreground">{encodedFidelity > 0 ? `Entered with the ${kind === "New Sales" ? "New Sales" : "Collections"} batch: ${money(encodedFidelity)}, the employee's own money, included in the expected amount.` : "The employee's own money handed over for their savings; zero is allowed. It is added to the expected amount."}</p></Field><MetricTile tone={Math.round(((Number(actualAmount) || 0) - expectedAmount) * 100) === 0 ? "success" : "danger"} label="Difference" value={money((Number(actualAmount) || 0) - expectedAmount)} detail="Actual minus expected" /></div>
        <Field label="Remarks"><Input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional turnover notes" /></Field>
        <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm"><input type="checkbox" className="mt-1" checked={cashConfirmed} disabled={Math.round(expectedAmount*100) !== Math.round(Number(actualAmount)*100)} onChange={(event) => setCashConfirmed(event.target.checked)} /><span><strong>Cash received in full</strong><span className="block text-xs text-muted-foreground">Create and immediately approve this Remittance. Available when the actual cash equals the expected amount to the centavo.</span></span></label>
        <Button type="button" disabled={saving || !selected.length || actualAmount === "" || !remittanceDate} onClick={() => void createRemittance()}>{saving ? "Saving..." : cashConfirmed ? "Save and Approve" : "Submit for Approval"}</Button>
      </CardContent></Card>}

      {view === "approval" && <Card><CardHeader><CardTitle>Pending Approval</CardTitle><p className="text-sm text-muted-foreground">Accountability remains open until an authorized user approves the turnover.</p></CardHeader><CardContent><div className="space-y-3">{pending.map((item) => <div key={item.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="font-mono text-sm font-semibold">{item.id}</p><p className="text-sm">{item.accountableName} · {item.branch} · {item.collectionCount} Collections</p><p className="text-xs text-muted-foreground">Expected {money(item.expectedAmount)} · Actual {money(item.actualAmount)} · Difference {money(item.difference)}</p>{item.penaltyAmount > 0 && <p className="mt-1 text-xs font-semibold text-red-700">Penalty {money(item.penaltyAmount)} (separate from remittance): <span className="font-normal">{item.penaltyNotes.join("; ")}</span></p>}{item.fidelityAmount > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">MAS Fidelity {money(item.fidelityAmount)} (separate from remittance) <span className="font-normal">deducted from the MAS&apos;s incentives and saved to their Fidelity</span></p>}<div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusBadge status={item.status}/><StatusBadge status={`${item.type} slip`} tone={item.type === "New Sales" ? "info" : "neutral"}/>{item.paymentMethods.map((method) => <StatusBadge key={method} status={method === "Cash" ? "Cash" : `${method} · verify reference`} tone={method === "Cash" ? "neutral" : "info"}/>)}{!!item.paymentReferences.length && <span className="text-xs text-muted-foreground">Ref {item.paymentReferences.join(", ")}</span>}</div></div><div className="flex gap-2"><Button type="button" disabled={saving} onClick={() => void decide(item.id, "approve", item.difference !== 0)}>Approve</Button><Button type="button" variant="outline" disabled={saving} onClick={() => void decide(item.id, "reject")}>Reject</Button></div></div></div>)}{!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No Remittances are awaiting approval.</p>}</div></CardContent></Card>}

      {view === "records" && <Card><CardHeader><CardTitle>Remittance Records</CardTitle></CardHeader><CardContent><DataTable headers={["Remittance", "Slip", "Date", "Accountable person", "Expected", "Penalty", "Actual", "Fidelity", "Difference", "Status", "Remarks / Reason", "Decision by"]} rows={records.map((item) => [item.id, item.type, item.remittanceDate, item.accountableName, money(item.expectedAmount), item.penaltyAmount > 0 ? <span key="penalty" className="text-red-700" title={item.penaltyNotes.join("; ")}>{money(item.penaltyAmount)}<span className="block text-xs">{item.penaltyNotes.join("; ")}</span></span> : "—", money(item.actualAmount), item.fidelityAmount > 0 ? <span key="fidelity" className="text-emerald-700">{money(item.fidelityAmount)}<span className="block text-xs">deducted from incentives</span></span> : "—", money(item.difference), <StatusBadge key="status" status={item.status}/>, item.decisionReason || item.remarks || "—", item.decisionByName])} empty="No approved or rejected Remittances." /></CardContent></Card>}

      {view === "reports" && <Card><CardHeader><CardTitle>Outstanding Cash Aging</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Field label="From OR date"><Input type="date" value={reportFrom} onChange={(event)=>setReportFrom(event.target.value)}/></Field><Field label="To OR date"><Input type="date" value={reportTo} onChange={(event)=>setReportTo(event.target.value)}/></Field><Field label="Branch"><SearchSelect aria-label="Branch" className="h-9" clearable placeholder="All branches" value={reportBranch} onValueChange={setReportBranch} options={[...new Set((data?.outstanding??[]).map(item=>item.branch))].filter(Boolean).sort().map(branch=>({value:branch,label:branch}))}/></Field></div><DataTable headers={["Collection", "Collector / MAS", "Branch", "OR date", "Age", "Remittance due"]} rows={(data?.outstanding ?? []).filter(item=>(!reportFrom||item.orDate>=reportFrom)&&(!reportTo||item.orDate<=reportTo)&&(!reportBranch||item.branch===reportBranch)).map((item) => [item.id, item.accountableName, item.branch, item.orDate, `${item.daysOutstanding} days`, money(item.remittanceAmount)])} empty="No outstanding cash matches these filters." /></CardContent></Card>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) { return <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/50 text-left"><tr>{headers.map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row[0])}-${index}`} className="border-t">{row.map((value, cellIndex) => <td key={cellIndex} className="p-3">{value}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }

function PaymentLabel({ by, method, reference }: { by: string; method: string; reference: string }) {
  return <span className="block leading-tight"><span className="block text-sm">{by || "MAS"} · {method}</span>{reference && <span className="block font-mono text-xs text-muted-foreground">Ref {reference}</span>}</span>;
}
