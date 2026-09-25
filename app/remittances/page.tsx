"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, CheckCircle2, FileCheck2, LayoutDashboard, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";

type Collection = { id: string; memberNumber: string; programId: string; branch: string; accountableEmployeeId: string; accountableName: string; accountableRole: string; orNumber: string; orDate: string; amount: number; remittanceStatus: string };
type Remittance = { id: string; branch: string; accountableName: string; remittanceDate: string; status: string; submittedByUsername: string; expectedAmount: number; actualAmount: number; difference: number; collectionCount: number; receivedByName: string; decisionByUsername: string; decisionAt: string; remarks: string; rejectionReason: string; collectionIds: string[] };
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
  const [remittanceDate, setRemittanceDate] = useState(today());
  const [receivedByName, setReceivedByName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

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

  const ownerCollections = useMemo(() => data?.outstanding.filter((collection) => `${collection.accountableEmployeeId}|${collection.accountableName}|${collection.branch}` === ownerKey) ?? [], [data, ownerKey]);
  const selectedCollections = ownerCollections.filter((collection) => selected.includes(collection.id));
  const expectedAmount = selectedCollections.reduce((sum, collection) => sum + collection.amount, 0);
  const pending = data?.remittances.filter((item) => ["Pending Approval", "Discrepancy"].includes(item.status)) ?? [];
  const records = data?.remittances.filter((item) => ["Approved", "Rejected"].includes(item.status)) ?? [];

  const createRemittance = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/remittances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionIds: selected, actualAmount: Number(actualAmount), remittanceDate, receivedByName, remarks }) });
      const result = await parseJsonResponse<{ error?: string; remittance?: { id: string; status: string } }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to create Remittance.");
      setMessage(`${result.remittance?.id} submitted as ${result.remittance?.status}.`);
      setSelected([]); setActualAmount(""); setRemarks(""); setView("approval"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create Remittance."); }
    finally { setSaving(false); }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    const reason = decision === "reject" ? window.prompt("Rejection reason (required):") : "";
    if (decision === "reject" && !reason?.trim()) return;
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Remittance</h1><p className="text-sm text-muted-foreground">Physical cash turnover, verification, approval, and Collector/MAS accountability.</p></div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Outstanding Accountability" value={money(data?.summary.outstandingAmount ?? 0)} detail={`${data?.summary.outstandingCount ?? 0} Collections`} />
        <Metric label="Pending Approval" value={money(data?.summary.pendingAmount ?? 0)} detail={`${data?.summary.pendingCount ?? 0} Remittances`} />
        <Metric label="Approved Today" value={money(data?.summary.approvedTodayAmount ?? 0)} detail={`${data?.summary.approvedTodayCount ?? 0} Remittances`} />
        <Metric label="Discrepancies" value={money(data?.summary.discrepancyAmount ?? 0)} detail="Absolute shortage / overage" />
      </div>
      {(data?.summary.historicalReviewCount ?? 0) > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data?.summary.historicalReviewCount} historical Collections predate this approval workflow and require reconciliation before they affect accountability.</p>}

      <div className="overflow-x-auto border-b"><div className="flex min-w-max gap-1" role="tablist">{views.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${view === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" />{item.label}</button>; })}</div></div>

      {view === "dashboard" && <Card><CardHeader><CardTitle>Accountability by Collector / MAS</CardTitle></CardHeader><CardContent><DataTable headers={["Accountable person", "Role", "Branch", "Collections", "Outstanding"]} rows={(data?.accountability ?? []).map((row) => [row.name || row.employeeId || "Unassigned", row.role, row.branch, String(row.collectionCount), money(row.outstandingAmount)])} empty="No outstanding Collections." /></CardContent></Card>}

      {view === "new" && <Card><CardHeader><CardTitle>New Remittance</CardTitle><p className="text-sm text-muted-foreground">Choose one accountable person, then select the exact Collections included in the cash turnover.</p></CardHeader><CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label htmlFor="owner">Collector / MAS</Label><select id="owner" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={ownerKey} onChange={(event) => { setOwnerKey(event.target.value); setSelected([]); setActualAmount(""); }}><option value="">Select accountable person</option>{(data?.accountability ?? []).filter((owner) => data?.outstanding.some((collection) => collection.accountableEmployeeId === owner.employeeId && collection.accountableName === owner.name && collection.branch === owner.branch)).map((owner) => <option key={`${owner.employeeId}|${owner.name}|${owner.branch}`} value={`${owner.employeeId}|${owner.name}|${owner.branch}`}>{owner.name || owner.employeeId} · {owner.branch} · {money(owner.outstandingAmount)}</option>)}</select></div><Field label="Turnover date"><Input type="date" value={remittanceDate} onChange={(event) => setRemittanceDate(event.target.value)} /></Field><Field label="Received by"><Input value={receivedByName} onChange={(event) => setReceivedByName(event.target.value)} placeholder="Cashier / receiving person" /></Field></div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-3">Select</th><th className="p-3">Collection</th><th className="p-3">Member</th><th className="p-3">Program</th><th className="p-3">OR Date</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{ownerCollections.map((collection) => <tr key={collection.id} className="border-t"><td className="p-3"><input type="checkbox" checked={selected.includes(collection.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, collection.id] : current.filter((id) => id !== collection.id))} /></td><td className="p-3 font-mono text-xs">{collection.id}</td><td className="p-3">{collection.memberNumber}</td><td className="p-3">{collection.programId}</td><td className="p-3">{collection.orDate}</td><td className="p-3 text-right">{money(collection.amount)}</td></tr>)}{!ownerCollections.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Select an accountable person with outstanding Collections.</td></tr>}</tbody></table></div>
        <div className="grid gap-4 md:grid-cols-3"><Metric label="Selected Collections" value={String(selected.length)} detail={`Expected ${money(expectedAmount)}`} /><Field label="Actual amount received"><Input type="number" min="0" step="0.01" value={actualAmount} onChange={(event) => setActualAmount(event.target.value)} /></Field><Metric label="Difference" value={money((Number(actualAmount) || 0) - expectedAmount)} detail="Actual minus expected" /></div>
        <Field label="Remarks"><Input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional turnover notes" /></Field>
        <Button type="button" disabled={saving || !selected.length || actualAmount === "" || !remittanceDate} onClick={() => void createRemittance()}>{saving ? "Submitting..." : "Submit for Approval"}</Button>
      </CardContent></Card>}

      {view === "approval" && <Card><CardHeader><CardTitle>Pending Approval</CardTitle><p className="text-sm text-muted-foreground">Accountability remains open until an authorized user approves the turnover.</p></CardHeader><CardContent><div className="space-y-3">{pending.map((item) => <div key={item.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="font-mono text-sm font-semibold">{item.id}</p><p className="text-sm">{item.accountableName} · {item.branch} · {item.collectionCount} Collections</p><p className="text-xs text-muted-foreground">Expected {money(item.expectedAmount)} · Actual {money(item.actualAmount)} · Difference {money(item.difference)} · {item.status}</p></div><div className="flex gap-2"><Button type="button" disabled={saving} onClick={() => void decide(item.id, "approve")}>Approve</Button><Button type="button" variant="outline" disabled={saving} onClick={() => void decide(item.id, "reject")}>Reject</Button></div></div></div>)}{!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No Remittances are awaiting approval.</p>}</div></CardContent></Card>}

      {view === "records" && <Card><CardHeader><CardTitle>Remittance Records</CardTitle></CardHeader><CardContent><DataTable headers={["Remittance", "Date", "Accountable person", "Expected", "Actual", "Difference", "Status", "Decision by"]} rows={records.map((item) => [item.id, item.remittanceDate, item.accountableName, money(item.expectedAmount), money(item.actualAmount), money(item.difference), item.status, item.decisionByUsername])} empty="No approved or rejected Remittances." /></CardContent></Card>}

      {view === "reports" && <Card><CardHeader><CardTitle>Accountability Report</CardTitle></CardHeader><CardContent><DataTable headers={["Collector / MAS", "Branch", "Outstanding Collections", "Outstanding Amount"]} rows={(data?.accountability ?? []).map((row) => [row.name, row.branch, String(row.collectionCount), money(row.outstandingAmount)])} empty="No report data." /></CardContent></Card>}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function DataTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) { return <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/50 text-left"><tr>{headers.map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-t">{row.map((value, cellIndex) => <td key={cellIndex} className="p-3">{value}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }
