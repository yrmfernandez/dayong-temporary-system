"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileCheck2, LayoutDashboard, RefreshCw, Search, Wallet } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { parseJsonResponse } from "@/lib/api-response";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Kind = "Collections" | "New Sales";
type Item = { kind: Kind; id: string; memberNumber: string; branch: string; accountableName: string; accountableRole: string; orNumber: string; orDate: string; amount: number; remittanceAmount: number; remittanceStatus: string; daysOutstanding: number; photoId: string; encodedByEmployeeId: string; encodedByName: string; encodedAt: string; linkedRemittanceId: string };
type Remittance = {
  type: Kind; id: string; branch: string; accountableName: string; accountableRole: string; remittanceDate: string; remittanceTime: string; cashCount: string; status: string;
  expectedAmount: number; actualAmount: number; difference: number; fidelityAmount: number; collectionCount: number; decisionByName: string; decisionAt: string; remarks: string; decisionReason: string;
  collectionIds: string[]; paymentMethods: string[]; paymentReferences: string[]; penaltyAmount: number; penaltyNotes: string[]; photoIds: string[]; missingPhotos: string[]; clerkIds: string[]; clerkNames: string[];
};
type Dashboard = {
  summary: { outstandingAmount: number; outstandingCount: number; pendingAmount: number; pendingCount: number; approvedTodayAmount: number; approvedTodayCount: number; discrepancyAmount: number; historicalReviewCount: number };
  accountability: Array<{ employeeId: string; name: string; role: string; branch: string; collectionCount: number; outstandingAmount: number }>;
  outstanding: Item[];
  remittances: Remittance[];
  clerks: Array<{ employeeId: string; name: string }>;
  canApprove: boolean;
  clerk: string;
};
type View = "dashboard" | "approval" | "reports";

const views = [
  { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
  { id: "approval" as const, label: "Pending Approval", icon: FileCheck2 },
  { id: "reports" as const, label: "Reports", icon: BarChart3 },
];
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Remittances. Entries reach Pending Approval on their own once their receipt photos are attached (My Entries / Today's
 * Entries). An Entry Clerk sees only their own; approvers see everyone's, can filter by Entry Clerk and search, and
 * approve or reject slips one at a time, the selected ones, or all.
 */
export default function RemittancesPage() {
  const [view, setView] = useState<View>("dashboard");
  const [clerk, setClerk] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [reportFrom, setReportFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(today);
  const [reportBranch, setReportBranch] = useState("");

  const load = useCallback(async (nextClerk: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/remittances${nextClerk ? `?clerk=${encodeURIComponent(nextClerk)}` : ""}`, { cache: "no-store" });
      const result = await parseJsonResponse<Dashboard & { error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to load Remittances.");
      setData(result);
      setSelected([]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Remittances."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the chosen clerk's remittances
    void load(clerk);
  }, [load, clerk]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["remittances", "remittance_collections", "collections", "sales", "bank_deposits", "receipt_photos"], () => load(clerk));

  // Search narrows every list: slip or entry ID, accountable person, branch, or Entry Clerk.
  const term = search.trim().toLowerCase();
  const matches = (...values: string[]) => !term || values.some((value) => value.toLowerCase().includes(term));
  const pending = useMemo(() => (data?.remittances ?? []).filter((item) => ["Pending Approval", "Discrepancy"].includes(item.status) && matches(item.id, item.accountableName, item.branch, ...item.clerkNames)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches depends only on term
    [data, term]);
  const records = (data?.remittances ?? []).filter((item) => ["Approved", "Rejected"].includes(item.status) && matches(item.id, item.accountableName, item.branch, ...item.clerkNames));
  const waitingForPhotos = (data?.outstanding ?? []).filter((item) => item.remittanceStatus === "Outstanding" && !item.photoId && matches(item.id, item.accountableName, item.branch, item.encodedByName));
  const returned = (data?.outstanding ?? []).filter((item) => item.remittanceStatus === "Returned" && matches(item.id, item.accountableName, item.branch, item.encodedByName));
  const canApprove = Boolean(data?.canApprove);
  const approvable = pending.filter((item) => !item.missingPhotos.length).map((item) => item.id);

  const decide = async (ids: string[], decision: "approve" | "reject") => {
    if (!ids.length) return;
    const discrepancy = decision === "approve" && pending.some((item) => ids.includes(item.id) && item.difference !== 0);
    const reason = decision === "reject" ? window.prompt(`Why ${ids.length === 1 ? "is this remittance" : `are these ${ids.length} remittances`} being rejected? The entries go back to the Entry Clerk with this reason.`) : discrepancy ? window.prompt("Explain how the discrepancy was resolved (required):") : "";
    if ((decision === "reject" || discrepancy) && !reason?.trim()) return;
    if (decision === "approve" && ids.length > 1 && !window.confirm(`Approve ${ids.length} remittances?`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/remittances", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remittanceIds: ids, decision, reason }) });
      const result = await parseJsonResponse<{ error?: string; done?: string[]; failed?: string[] }>(response);
      if (!response.ok) throw new Error(result.error || "Unable to update the remittances.");
      setMessage(`${result.done?.length ?? ids.length} ${decision === "approve" ? "approved" : "rejected"}.${result.failed?.length ? ` Not done: ${result.failed.join(" ")}` : ""}`);
      await load(clerk);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update the remittances."); }
    finally { setSaving(false); }
  };

  if (loading && !data) return <p className="p-6 text-sm text-muted-foreground">Loading remittances...</p>;

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 rounded-3xl page-hero p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="rounded-md bg-violet-95 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-30">Finance</span>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Remittance</h1>
          <p className="text-sm text-violet-30/80">{canApprove ? "Entries reach Pending Approval on their own once their receipt photos are attached. Approve or reject them here." : "Your entries go to Pending Approval on their own once their receipt photos are attached in My Entries."}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load(clerk)} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {canApprove && (
          <div className="space-y-1">
            <Label>Entry Clerk</Label>
            <SearchSelect aria-label="Entry Clerk" className="h-9" clearable placeholder="All Entry Clerks" value={clerk} onValueChange={setClerk} options={(data?.clerks ?? []).map((item) => ({ value: item.employeeId, label: item.name || item.employeeId, description: item.employeeId }))} />
          </div>
        )}
        <div className="space-y-1 lg:col-span-2">
          <Label htmlFor="remittance-search">Search</Label>
          <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input id="remittance-search" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Slip or entry ID, Collector / MAS, branch, Entry Clerk" /></div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="warning" icon={Wallet} label="Not yet approved" value={money(data?.summary.outstandingAmount ?? 0)} detail={`${data?.summary.outstandingCount ?? 0} entries`} />
        <MetricTile tone="info" icon={Clock3} label="Pending Approval" value={money(data?.summary.pendingAmount ?? 0)} detail={`${data?.summary.pendingCount ?? 0} remittances`} />
        <MetricTile tone="success" icon={CheckCircle2} label="Approved Today" value={money(data?.summary.approvedTodayAmount ?? 0)} detail={`${data?.summary.approvedTodayCount ?? 0} remittances`} />
        <MetricTile tone={(data?.summary.discrepancyAmount ?? 0) ? "danger" : "teal"} icon={AlertTriangle} label="Discrepancies" value={money(data?.summary.discrepancyAmount ?? 0)} detail="Absolute shortage / overage" />
      </div>

      <div className="overflow-x-auto border-b"><div className="flex min-w-max gap-1" role="tablist">{views.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${view === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" />{item.label}{item.id === "approval" && pending.length ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{pending.length}</span> : null}</button>; })}</div></div>

      {view === "dashboard" && (
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Cash to account for, by Collector / MAS</CardTitle><p className="text-sm text-muted-foreground">Entries not yet approved: waiting for a receipt photo, pending approval, or returned.</p></CardHeader><CardContent><DataTable headers={["Accountable person", "Role", "Branch", "Entries", "Amount"]} rows={(data?.accountability ?? []).filter((row) => matches(row.name, row.branch)).map((row) => [row.name || row.employeeId || "Unassigned", row.role, row.branch, String(row.collectionCount), money(row.outstandingAmount)])} empty="Nothing to account for." /></CardContent></Card>
          <Card><CardHeader><CardTitle>Waiting for a receipt photo ({waitingForPhotos.length})</CardTitle><p className="text-sm text-muted-foreground">They go to Pending Approval on their own once the photo is attached in My Entries or Today&apos;s Entries.</p></CardHeader><CardContent><DataTable headers={["Entry", "Type", "Collector / MAS", "Branch", "OR · date", "Encoded by", "Amount"]} rows={waitingForPhotos.map((item) => [item.id, item.kind, item.accountableName, item.branch, `${item.orNumber || "—"} · ${item.orDate}`, `${item.encodedByName || "—"}${item.encodedAt ? ` · ${item.encodedAt}` : ""}`, money(item.amount)])} empty="Every entry has its receipt photo." /></CardContent></Card>
          {returned.length > 0 && <Card><CardHeader><CardTitle>Returned to the Entry Clerk ({returned.length})</CardTitle><p className="text-sm text-muted-foreground">Rejected by an approver; the clerk fixes and resubmits them in My Entries.</p></CardHeader><CardContent><DataTable headers={["Entry", "Type", "Collector / MAS", "Branch", "Encoded by", "Amount"]} rows={returned.map((item) => [item.id, item.kind, item.accountableName, item.branch, item.encodedByName || "—", money(item.amount)])} empty="" /></CardContent></Card>}
          {(data?.summary.historicalReviewCount ?? 0) > 0 && canApprove && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data?.summary.historicalReviewCount} historical entries predate this approval workflow and are not part of it.</p>}
        </div>
      )}

      {view === "approval" && (
        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><CardTitle>Pending Approval ({pending.length})</CardTitle><p className="text-sm text-muted-foreground">Check each remittance against its receipt photos. Rejected entries go back to the Entry Clerk with the reason.</p></div>
            {canApprove && pending.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={saving || !selected.length} onClick={() => void decide(selected.filter((id) => approvable.includes(id)), "approve")}>Approve selected ({selected.filter((id) => approvable.includes(id)).length})</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving || !selected.length} onClick={() => void decide(selected, "reject")}>Reject selected ({selected.length})</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving || !approvable.length} onClick={() => void decide(approvable, "approve")}>Approve all ({approvable.length})</Button>
                <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={saving} onClick={() => void decide(pending.map((item) => item.id), "reject")}>Reject all ({pending.length})</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {canApprove && pending.length > 0 && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.length === pending.length} onChange={(event) => setSelected(event.target.checked ? pending.map((item) => item.id) : [])} />Select all shown</label>
            )}
            {pending.map((item) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex gap-3">
                  {canApprove && <input type="checkbox" className="mt-1" aria-label={`Select ${item.id}`} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />}
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-mono text-sm font-semibold">{item.id}</p>
                        <p className="text-sm">{item.accountableName} · {item.branch} · {item.collectionCount} {item.type === "New Sales" ? "New Sale(s)" : "Collection(s)"}</p>
                        <p className="text-xs text-muted-foreground">Encoded by {item.clerkNames.join(", ") || "—"} · received {item.remittanceDate}{item.remittanceTime ? ` ${item.remittanceTime}` : ""}</p>
                        <p className="text-xs text-muted-foreground">Expected {money(item.expectedAmount)} · Actual {money(item.actualAmount)} · Difference {money(item.difference)}</p>
                      </div>
                      {canApprove && <div className="flex gap-2"><Button type="button" size="sm" disabled={saving || item.missingPhotos.length > 0} title={item.missingPhotos.length ? "Every item needs a receipt photo" : undefined} onClick={() => void decide([item.id], "approve")}>Approve</Button><Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void decide([item.id], "reject")}>Reject</Button></div>}
                    </div>
                    {item.penaltyAmount > 0 && <p className="text-xs font-semibold text-red-700">Penalty {money(item.penaltyAmount)} (separate from remittance): <span className="font-normal">{item.penaltyNotes.join("; ")}</span></p>}
                    {item.fidelityAmount > 0 && <p className="text-xs font-semibold text-emerald-700">Fidelity {money(item.fidelityAmount)} included in the expected amount</p>}
                    {item.remarks && <p className="text-xs text-muted-foreground">{item.remarks}</p>}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      <StatusBadge status={item.status} /><StatusBadge status={`${item.type} slip`} tone={item.type === "New Sales" ? "info" : "neutral"} />
                      {item.missingPhotos.length ? <span className="font-semibold text-amber-800">Receipt photos missing for {item.missingPhotos.join(", ")}.</span> : null}
                      {item.photoIds.map((photoId, index) => <ReceiptPhotoView key={photoId} photoId={photoId} label={`Receipt ${index + 1}`} />)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No remittances are waiting for approval.</p>}
          </CardContent>
        </Card>
      )}

      {view === "reports" && (
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Outstanding Cash Aging</CardTitle><p className="text-sm text-muted-foreground">Entries not yet approved, by how long since the OR date.</p></CardHeader><CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3"><Field label="From OR date"><Input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></Field><Field label="To OR date"><Input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></Field><Field label="Branch"><SearchSelect aria-label="Branch" className="h-9" clearable placeholder="All branches" value={reportBranch} onValueChange={setReportBranch} options={[...new Set((data?.outstanding ?? []).map((item) => item.branch))].filter(Boolean).sort().map((branch) => ({ value: branch, label: branch }))} /></Field></div>
            <DataTable headers={["Entry", "Collector / MAS", "Branch", "OR date", "Age", "Status", "Remittance due"]} rows={(data?.outstanding ?? []).filter((item) => (!reportFrom || item.orDate >= reportFrom) && (!reportTo || item.orDate <= reportTo) && (!reportBranch || item.branch === reportBranch) && matches(item.id, item.accountableName, item.branch, item.encodedByName)).map((item) => [item.id, item.accountableName, item.branch, item.orDate, `${item.daysOutstanding} days`, item.remittanceStatus === "Outstanding" && !item.photoId ? "Needs receipt photo" : item.remittanceStatus, money(item.remittanceAmount)])} empty="No outstanding cash matches these filters." />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Remittance Records</CardTitle><p className="text-sm text-muted-foreground">Approved and rejected remittances.</p></CardHeader><CardContent>
            <DataTable headers={["Remittance", "Slip", "Received", "Accountable person", "Encoded by", "Expected", "Actual", "Difference", "Status", "Remarks / Reason", "Decision by"]} rows={records.map((item) => [item.id, item.type, item.remittanceTime ? `${item.remittanceDate} ${item.remittanceTime}` : item.remittanceDate, item.accountableName, item.clerkNames.join(", ") || "—", money(item.expectedAmount), money(item.actualAmount), money(item.difference), <StatusBadge key="status" status={item.status} />, item.decisionReason || item.remarks || "—", item.decisionByName])} empty="No approved or rejected remittances." />
          </CardContent></Card>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) { return <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/50 text-left"><tr>{headers.map((header) => <th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row[0])}-${index}`} className="border-t">{row.map((value, cellIndex) => <td key={cellIndex} className="p-3">{value}</td>)}</tr>)}{!rows.length && empty && <tr><td colSpan={headers.length} className="p-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }
