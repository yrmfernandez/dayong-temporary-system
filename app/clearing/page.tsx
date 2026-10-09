"use client";

import { BadgeCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { readApiResponse } from "@/lib/api-response";
import type { Clearing, ClearingStage } from "@/lib/clearing";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type PageData = { today: string; clearings: Clearing[]; branches: Array<{ id: string; name: string }>; employees: Array<{ id: string; name: string; roles: string[]; branchIds: string[] }> };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
/** Badge tone for each stage (lib/clearing.ts withProgress). */
const STAGE_TONE: Record<ClearingStage, "warning" | "orange" | "info" | "danger" | "success" | "neutral"> = {
  "Waiting for encoding": "warning", "Waiting for receipt": "orange", "For approval": "info", Returned: "danger", Approved: "success", Removed: "neutral",
};
const entrySummary = (item: Clearing) => {
  const entries = item.entries;
  if (!entries?.total) return "";
  const parts = [entries.receipt && `${entries.receipt} without receipt`, entries.approval && `${entries.approval} for approval`, entries.returned && `${entries.returned} returned`, entries.approved && `${entries.approved} approved`].filter(Boolean);
  return `${entries.total} entr${entries.total === 1 ? "y" : "ies"}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
};
const time = (stamp: string) => { if (!stamp) return ""; const [hours, minutes] = stamp.slice(11, 16).split(":").map(Number); return `${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`; };

/**
 * Clearing (October 8, 2026): after checking a MAS's or employee's physical receipts and bank slips, the entry clerk
 * lists them here. New Sales and Collections can only be encoded for someone cleared for that branch that day, and the
 * clearing time is when the cash was received, so entries encoded later keep their incentive (lib/clearing.ts).
 */
export default function ClearingPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [branch, setBranch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clearing", { cache: "no-store" });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load Clearing.");
      setData(result as unknown as PageData);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load Clearing."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { void load(); }, [load]);
  // Entries saved, photos attached and approvals all move a line along, so those tables reload it too.
  useLiveRefresh(["clearings", "remittances", "collections", "sales", "receipt_photos"], load);

  const selectedBranchId = data?.branches.find((item) => item.name === branch)?.id ?? "";
  const people = useMemo(() => (data?.employees ?? []).filter((person) => selectedBranchId && person.branchIds.includes(selectedBranchId)), [data, selectedBranchId]);
  const open = (data?.clearings ?? []).filter((item) => item.stage !== "Approved" && item.stage !== "Removed");
  const closedToday = (data?.clearings ?? []).filter((item) => item.stage === "Approved" || item.stage === "Removed");

  async function clear(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/clearing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch, employeeId, amount, notes }) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to clear.");
      setMessage(result.message || "Cleared."); setEmployeeId(""); setAmount(""); setNotes("");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to clear."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/clearing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(removing) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to remove.");
      setMessage(result.message || "Removed."); setRemoving(null);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to remove."); }
    finally { setBusy(false); }
  }

  const row = (item: Clearing) => (
    <tr key={item.id} className="border-t align-top">
      <td className="p-3"><strong>{item.employeeName || item.employeeId}</strong><span className="block text-xs text-muted-foreground">{item.employeeId}</span></td>
      <td className="p-3">{item.branch}</td>
      <td className="p-3 tabular-nums">{item.clearedDate === data?.today ? time(item.clearedAt) : `${item.clearedDate} ${time(item.clearedAt)}`}<span className="block text-xs text-muted-foreground">by {item.clearedBy || "—"}</span></td>
      <td className="p-3 tabular-nums">{item.amount != null ? money(item.amount) : "—"}</td>
      <td className="max-w-64 p-3 text-xs">{item.notes || "—"}{item.closedReason && <span className="block text-muted-foreground">Removed: {item.closedReason}</span>}</td>
      <td className="p-3"><StatusBadge status={item.stage ?? "Waiting for encoding"} tone={STAGE_TONE[item.stage ?? "Waiting for encoding"]} />{entrySummary(item) && <span className="mt-1 block text-xs text-muted-foreground">{entrySummary(item)}</span>}{item.remittanceId && <span className="block font-mono text-[11px] text-muted-foreground">{item.remittanceId}</span>}</td>
      <td className="p-3 text-right">{item.status === "Open" && item.stage === "Waiting for encoding" && <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(removing?.id === item.id ? null : { id: item.id, reason: "" })}>Remove</Button>}</td>
    </tr>
  );

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><BadgeCheck className="size-6" /></div>
          <div><h1 className="text-2xl font-bold">Clearing</h1><p className="text-sm text-muted-foreground">After checking a MAS&apos;s receipts and bank slips, list them here. Their New Sales and Collections for the day can then be encoded, and this time counts as when the cash was received.</p></div></div>
        <Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />Refresh</Button>
      </header>

      <Card><CardHeader><CardTitle>Mark as cleared</CardTitle></CardHeader><CardContent>
        <form className="grid gap-3 md:grid-cols-[1fr_1.4fr_9rem_1.4fr_auto] md:items-end" onSubmit={(event) => void clear(event)}>
          <div className="space-y-1"><Label>Branch *</Label><SearchSelect aria-label="Branch" className="h-9" placeholder="Choose branch" value={branch} onValueChange={(value) => { setBranch(value); setEmployeeId(""); }} options={(data?.branches ?? []).map((item) => ({ value: item.name, label: item.name }))} /></div>
          <div className="space-y-1"><Label>MAS / employee *</Label><SearchSelect aria-label="MAS or employee" className="h-9" disabled={!branch} placeholder={branch ? "Search name or ID" : "Choose the branch first"} value={employeeId} onValueChange={setEmployeeId} options={people.map((person) => ({ value: person.id, label: person.name, description: `${person.id} · ${person.roles.join(", ") || "No role"}` }))} /></div>
          <div className="space-y-1"><Label htmlFor="clearing-amount">Amount</Label><Input id="clearing-amount" type="number" min="0" step="0.01" placeholder="Optional" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="clearing-notes">Notes</Label><Input id="clearing-notes" maxLength={300} placeholder="e.g. 12 receipts, 1 bank slip" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <Button type="submit" disabled={busy || !branch || !employeeId}>{busy ? "Saving..." : "Mark cleared"}</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">The time is recorded when you press the button. The incentive is kept when this is by 3:00 PM the day after the OR date. Without a clearing, New Sales and Collections for that MAS, branch and day cannot be saved.</p>
      </CardContent></Card>

      {message && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {removing && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <div className="min-w-64 flex-1 space-y-1"><Label htmlFor="clearing-remove-reason">Reason for removing *</Label><Input id="clearing-remove-reason" maxLength={300} placeholder="e.g. Listed the wrong MAS" value={removing.reason} onChange={(event) => setRemoving({ ...removing, reason: event.target.value })} /></div>
        <Button type="button" variant="destructive" disabled={busy || removing.reason.trim().length < 3} onClick={() => void remove()}>Remove</Button>
        <Button type="button" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
      </div>}

      <Card><CardHeader><CardTitle>In progress ({open.length})</CardTitle><p className="text-sm text-muted-foreground">Each line moves by itself: Waiting for encoding → Waiting for receipt (saved in My Entries, receipt photo not attached yet) → For approval (sent for remittance approval) → Approved. Returned means the approver sent entries back. Lines from earlier days stay here until they are approved.</p></CardHeader><CardContent>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/50"><tr>{["MAS / employee", "Branch", "Cleared", "Amount", "Notes", "Status", ""].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{open.map(row)}{!open.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{data ? "Nothing in progress." : "Loading..."}</td></tr>}</tbody></table></div>
      </CardContent></Card>

      {closedToday.length > 0 && <Card><CardHeader><CardTitle>Approved today ({closedToday.length})</CardTitle><p className="text-sm text-muted-foreground">Every entry saved and approved (or the line removed). These leave the page after 11:59 PM.</p></CardHeader><CardContent>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/50"><tr>{["MAS / employee", "Branch", "Cleared", "Amount", "Notes", "Status", ""].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{closedToday.map(row)}</tbody></table></div>
      </CardContent></Card>}
    </section>
  );
}
