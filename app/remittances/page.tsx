"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileCheck2, LayoutDashboard, Plus, RefreshCw, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";

type Collection = { id: string; batchId: string; memberNumber: string; programId: string; branch: string; accountableEmployeeId: string; accountableName: string; accountableRole: string; orNumber: string; orDate: string; amount: number; remittanceAmount:number; remittanceStatus: string; daysOutstanding:number; collectedBy: string; paymentMethod: string; paymentReference: string };
type Remittance = { id: string; branch: string; accountableName: string; accountableEmployeeId:string; accountableRole:string; remittanceDate: string; status: string; submittedByName: string; expectedAmount: number; actualAmount: number; difference: number; fidelityAmount:number; collectionCount: number; receivedByName: string; decisionByName: string; decisionAt: string; remarks: string; decisionReason: string; collectionIds: string[]; paymentMethods: string[]; paymentReferences: string[] };
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
  const ownerCollections = useMemo(() => data?.outstanding.filter((collection) => `${collection.accountableEmployeeId}|${collection.accountableName}|${collection.branch}` === ownerKey) ?? [], [data, ownerKey]);
  const selectedCollections = ownerCollections.filter((collection) => selected.includes(collection.id));
  const expectedAmount = selectedCollections.reduce((sum, collection) => sum + collection.remittanceAmount, 0) + Number(fidelityAmount || 0);
  const availableMasIncentive=selectedCollections.reduce((sum,collection)=>sum+Math.max(0,collection.amount-collection.remittanceAmount),0);
  const pending = data?.remittances.filter((item) => ["Pending Approval", "Discrepancy"].includes(item.status)) ?? [];
  const records = data?.remittances.filter((item) => ["Approved", "Rejected"].includes(item.status)) ?? [];

  const createRemittance = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const fullCash = cashConfirmed && Math.round(expectedAmount * 100) === Math.round(Number(actualAmount) * 100);
      const response = await fetch("/api/remittances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionIds: selected, actualAmount: Number(actualAmount), fidelityAmount:Number(fidelityAmount||0), remittanceDate, remarks, cashConfirmed: fullCash }) });
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

      {view === "new" && <Card><CardHeader><CardTitle>New Remittance</CardTitle><p className="text-sm text-muted-foreground">Choose one accountable person, then select the exact Collections included in the cash turnover.</p></CardHeader><CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label htmlFor="owner">Collector / MAS</Label><select id="owner" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={ownerKey} onChange={(event) => { setOwnerKey(event.target.value); setSelected([]); setActualAmount(""); }}><option value="">Select accountable person</option>{(data?.accountability ?? []).filter((owner) => data?.outstanding.some((collection) => collection.accountableEmployeeId === owner.employeeId && collection.accountableName === owner.name && collection.branch === owner.branch)).map((owner) => <option key={`${owner.employeeId}|${owner.name}|${owner.branch}`} value={`${owner.employeeId}|${owner.name}|${owner.branch}`}>{owner.name || owner.employeeId} · {owner.branch} · {money(owner.outstandingAmount)}</option>)}</select></div><Field label="Turnover date"><Input type="date" value={remittanceDate} onChange={(event) => setRemittanceDate(event.target.value)} /></Field><Field label="Received by"><Input value={receivedByName} readOnly className="bg-muted/50" /></Field></div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-3">Select</th><th className="p-3">Collection</th><th className="p-3">Member</th><th className="p-3">Program</th><th className="p-3">OR Date</th><th className="p-3">Collected by · Remittance method</th><th className="p-3 text-right">Collected</th><th className="p-3 text-right">Remittance</th></tr></thead><tbody>{ownerCollections.map((collection) => <tr key={collection.id} className="border-t"><td className="p-3"><input type="checkbox" checked={selected.includes(collection.id)} onChange={(event) => { const batchIds = collection.batchId ? ownerCollections.filter((item) => item.batchId === collection.batchId).map((item) => item.id) : [collection.id]; setSelected((current) => event.target.checked ? [...new Set([...current, ...batchIds])] : current.filter((id) => !batchIds.includes(id))); }} /></td><td className="p-3 font-mono text-xs">{collection.id}</td><td className="p-3">{collection.memberNumber}</td><td className="p-3">{collection.programId}</td><td className="p-3">{collection.orDate}</td><td className="p-3"><PaymentLabel by={collection.collectedBy} method={collection.paymentMethod} reference={collection.paymentReference} /></td><td className="p-3 text-right">{money(collection.amount)}</td><td className="p-3 text-right font-medium">{money(collection.remittanceAmount)}</td></tr>)}{!ownerCollections.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Select an accountable person with outstanding Collections.</td></tr>}</tbody></table></div>
        <div className="grid gap-4 md:grid-cols-4"><MetricTile tone="brand" label="Selected Collections" value={String(selected.length)} detail={`Expected ${money(expectedAmount)}`} /><Field label="Actual amount received"><Input type="number" min="0" step="0.01" value={actualAmount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setActualAmount(event.target.value)} /></Field><Field label="MAS Fidelity"><Input type="number" min="0" max={Math.min(10000,availableMasIncentive)} step="0.01" value={fidelityAmount} disabled={ownerCollections[0]?.accountableRole.toLowerCase()!=="mas"} onWheel={(event)=>event.currentTarget.blur()} onChange={(event)=>setFidelityAmount(event.target.value)}/><p className="text-xs text-muted-foreground">Requested by the MAS; zero is allowed. Available incentive: {money(availableMasIncentive)}.</p></Field><MetricTile tone={Math.round(((Number(actualAmount) || 0) - expectedAmount) * 100) === 0 ? "success" : "danger"} label="Difference" value={money((Number(actualAmount) || 0) - expectedAmount)} detail="Actual minus expected" /></div>
        <Field label="Remarks"><Input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional turnover notes" /></Field>
        <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm"><input type="checkbox" className="mt-1" checked={cashConfirmed} disabled={Math.round(expectedAmount*100) !== Math.round(Number(actualAmount)*100)} onChange={(event) => setCashConfirmed(event.target.checked)} /><span><strong>Cash received in full</strong><span className="block text-xs text-muted-foreground">Create and immediately approve this Remittance. Available when the actual cash equals the expected amount (including Fidelity) to the centavo.</span></span></label>
        <Button type="button" disabled={saving || !selected.length || actualAmount === "" || !remittanceDate} onClick={() => void createRemittance()}>{saving ? "Saving..." : cashConfirmed ? "Save and Approve" : "Submit for Approval"}</Button>
      </CardContent></Card>}

      {view === "approval" && <Card><CardHeader><CardTitle>Pending Approval</CardTitle><p className="text-sm text-muted-foreground">Accountability remains open until an authorized user approves the turnover.</p></CardHeader><CardContent><div className="space-y-3">{pending.map((item) => <div key={item.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="font-mono text-sm font-semibold">{item.id}</p><p className="text-sm">{item.accountableName} · {item.branch} · {item.collectionCount} Collections</p><p className="text-xs text-muted-foreground">Expected {money(item.expectedAmount)} · Actual {money(item.actualAmount)} · Difference {money(item.difference)}</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusBadge status={item.status}/>{item.paymentMethods.map((method) => <StatusBadge key={method} status={method === "Cash" ? "Cash" : `${method} · verify reference`} tone={method === "Cash" ? "neutral" : "info"}/>)}{!!item.paymentReferences.length && <span className="text-xs text-muted-foreground">Ref {item.paymentReferences.join(", ")}</span>}</div></div><div className="flex gap-2"><Button type="button" disabled={saving} onClick={() => void decide(item.id, "approve", item.difference !== 0)}>Approve</Button><Button type="button" variant="outline" disabled={saving} onClick={() => void decide(item.id, "reject")}>Reject</Button></div></div></div>)}{!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No Remittances are awaiting approval.</p>}</div></CardContent></Card>}

      {view === "records" && <Card><CardHeader><CardTitle>Remittance Records</CardTitle></CardHeader><CardContent><DataTable headers={["Remittance", "Date", "Accountable person", "Expected", "Actual", "Fidelity", "Difference", "Status", "Remarks / Reason", "Decision by"]} rows={records.map((item) => [item.id, item.remittanceDate, item.accountableName, money(item.expectedAmount), money(item.actualAmount), money(item.fidelityAmount), money(item.difference), <StatusBadge key="status" status={item.status}/>, item.decisionReason || item.remarks || "—", item.decisionByName])} empty="No approved or rejected Remittances." /></CardContent></Card>}

      {view === "reports" && <Card><CardHeader><CardTitle>Outstanding Cash Aging</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Field label="From OR date"><Input type="date" value={reportFrom} onChange={(event)=>setReportFrom(event.target.value)}/></Field><Field label="To OR date"><Input type="date" value={reportTo} onChange={(event)=>setReportTo(event.target.value)}/></Field><Field label="Branch"><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={reportBranch} onChange={(event)=>setReportBranch(event.target.value)}><option value="">All branches</option>{[...new Set((data?.outstanding??[]).map(item=>item.branch))].sort().map(branch=><option key={branch}>{branch}</option>)}</select></Field></div><DataTable headers={["Collection", "Collector / MAS", "Branch", "OR date", "Age", "Remittance due"]} rows={(data?.outstanding ?? []).filter(item=>(!reportFrom||item.orDate>=reportFrom)&&(!reportTo||item.orDate<=reportTo)&&(!reportBranch||item.branch===reportBranch)).map((item) => [item.id, item.accountableName, item.branch, item.orDate, `${item.daysOutstanding} days`, money(item.remittanceAmount)])} empty="No outstanding cash matches these filters." /></CardContent></Card>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) { return <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/50 text-left"><tr>{headers.map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row[0])}-${index}`} className="border-t">{row.map((value, cellIndex) => <td key={cellIndex} className="p-3">{value}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }

function PaymentLabel({ by, method, reference }: { by: string; method: string; reference: string }) {
  return <span className="block leading-tight"><span className="block text-sm">{by || "MAS"} · {method}</span>{reference && <span className="block font-mono text-xs text-muted-foreground">Ref {reference}</span>}</span>;
}
