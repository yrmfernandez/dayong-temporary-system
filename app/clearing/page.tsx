"use client";

import { BadgeCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { confirmDialog } from "@/components/app-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { readApiResponse } from "@/lib/api-response";
import type { Clearing, ClearingCovers, ClearingStage } from "@/lib/clearing";
import { handoverLabel } from "@/lib/clearing-kinds";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type PageData = { today: string; clearings: Clearing[]; branches: Array<{ id: string; name: string }>; employees: Array<{ id: string; name: string; roles: string[]; branchIds: string[] }> };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
/** Badge tone for each stage (lib/clearing.ts withProgress). */
const STAGE_TONE: Record<ClearingStage, "warning" | "orange" | "info" | "danger" | "success" | "neutral"> = {
  "Waiting for encoding": "warning", "Waiting for receipt": "orange", "For approval": "info", Returned: "danger", Approved: "success", Removed: "neutral",
};
const entrySummary = (entries: Clearing["entries"]) => {
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
  // What the person is remitting; each kind is tracked on its own (lib/clearing.ts).
  const [covers, setCovers] = useState<ClearingCovers>("Both");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [tab, setTab] = useState("Waiting for encoding");
  // A clearing being corrected (owner, October 14, 2026): what is remitted, the branch, the MAS / employee.
  const [editing, setEditing] = useState<{ id: string; branch: string; employeeId: string; covers: ClearingCovers } | null>(null);
  const [editError, setEditError] = useState("");

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setEditError(""); setMessage("");
    try {
      const response = await fetch("/api/clearing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", ...editing }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update the clearing.");
      setMessage(result.message || "Updated."); setEditing(null);
      await load();
    } catch (failure) { setEditError(failure instanceof Error ? failure.message : "Unable to update the clearing."); }
    finally { setBusy(false); }
  }

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
  /*
   * Tabs by status, like Remittances (owner, October 14, 2026): one tab per stage in the order work flows, each with its
   * count; Approved today holds approved and removed lines. Newest clearing first within a tab.
   */
  const TABS = [
    { id: "Waiting for encoding", label: "Waiting for encoding", items: open.filter((item) => (item.stage ?? "Waiting for encoding") === "Waiting for encoding") },
    { id: "Waiting for receipt", label: "Waiting for receipt", items: open.filter((item) => item.stage === "Waiting for receipt") },
    { id: "For approval", label: "For approval", items: open.filter((item) => item.stage === "For approval") },
    { id: "Returned", label: "Returned", items: open.filter((item) => item.stage === "Returned") },
    { id: "Approved today", label: "Approved today", items: [...closedToday.filter((item) => item.stage === "Approved"), ...closedToday.filter((item) => item.stage !== "Approved")] },
  ] as const;
  const shownTab = TABS.find((item) => item.id === tab) ?? TABS[0];

  async function clear(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const send = (newHandover: boolean) => fetch("/api/clearing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch, employeeId, amount, notes, covers, newHandover }) }).then(readApiResponse);
      let result = await send(false);
      // Already cleared today (owner, October 23, 2026): a new clearing is only for a new handover of cash.
      if (!result.success && result.code === "ALREADY_CLEARED") {
        const newHandover = await confirmDialog(result.message, { title: "Already cleared today", confirmLabel: "New handover: clear again", cancelLabel: "Cancel", requireChoice: true });
        if (!newHandover) { setMessage("Not cleared again. Encode the remaining batches under the earlier clearing."); return; }
        // Allowed even before the earlier clearing is encoded (October 29, 2026); each batch then picks its handover.
        result = await send(true);
      }
      if (!result.success) throw new Error(result.message || "Unable to clear.");
      setMessage(result.message || "Cleared."); setEmployeeId(""); setAmount(""); setNotes(""); setCovers("Both");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to clear."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true); setRemoveError(""); setError(""); setMessage("");
    try {
      const response = await fetch("/api/clearing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(removing) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to remove.");
      setMessage(result.message || "Removed."); setRemoving(null);
      await load();
    } catch (failure) { setRemoveError(failure instanceof Error ? failure.message : "Unable to remove."); }
    finally { setBusy(false); }
  }

  const row = (item: Clearing) => (
    <Fragment key={item.id}>
    <tr className="border-t align-top">
      <td className="p-3"><strong>{item.employeeName || item.employeeId}</strong><span className="block text-xs text-muted-foreground">{item.employeeId}</span>{/* Two handovers the same day (October 29, 2026): the clerk picks the matching one when encoding. */}{(item.handovers ?? 0) > 1 && <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{handoverLabel(item.handover ?? 1)} of {item.handovers}</span>}</td>
      <td className="p-3">{item.branch}</td>
      <td className="p-3 tabular-nums">{item.clearedDate === data?.today ? time(item.clearedAt) : `${item.clearedDate} ${time(item.clearedAt)}`}<span className="block text-xs text-muted-foreground">by {item.clearedBy || "—"}</span></td>
      <td className="p-3 tabular-nums">{item.amount != null ? money(item.amount) : "—"}</td>
      <td className="max-w-64 p-3 text-xs">{item.notes || "—"}{item.closedReason && <span className="block text-muted-foreground">Removed: {item.closedReason}</span>}</td>
      <td className="p-3">{item.kinds?.length
        ? <div className="space-y-2">{item.kinds.map((part) => <div key={part.kind}><span className="block text-xs font-medium">{part.kind}</span><StatusBadge status={part.stage} tone={STAGE_TONE[part.stage]} />{/* Returned entries are fixed and resubmitted from My Entries (owner, October 17, 2026). */}{part.stage === "Returned" && <Link href="/my-entries" className="block text-xs font-medium text-primary underline-offset-2 hover:underline">Fix in My Entries, then Resubmit batch</Link>}{entrySummary(part.entries) && <span className="mt-0.5 block text-xs text-muted-foreground">{entrySummary(part.entries)}</span>}{/* Who approved or returned it, for tracking (owner, October 13, 2026). */}{(part.decisions ?? []).map((decision) => <span key={`${decision.status}-${decision.by}`} className={`block text-xs ${decision.status === "Returned" ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{decision.status} by {decision.by}{decision.at ? ` · ${decision.at.slice(0, 10) === data?.today ? time(decision.at) : `${decision.at.slice(0, 10)} ${time(decision.at)}`}` : ""}</span>)}</div>)}</div>
        : <><StatusBadge status={item.stage ?? "Waiting for encoding"} tone={STAGE_TONE[item.stage ?? "Waiting for encoding"]} /><span className="block text-xs text-muted-foreground">{item.covers === "Both" ? "New Sales and Collections" : `${item.covers} only`}</span></>}
        {item.remittanceId && <span className="block font-mono text-[11px] text-muted-foreground">{item.remittanceId}</span>}</td>
      <td className="space-y-1 p-3 text-right">{item.status !== "Removed" && item.stage !== "Approved" && <Button type="button" size="sm" variant="outline" disabled={busy} aria-expanded={editing?.id === item.id} onClick={() => { setEditError(""); setRemoving(null); setEditing(editing?.id === item.id ? null : { id: item.id, branch: item.branch, employeeId: item.employeeId, covers: item.covers }); }}>Edit</Button>}
        {item.status === "Open" && item.stage === "Waiting for encoding" && <Button type="button" size="sm" variant="outline" disabled={busy} aria-expanded={removing?.id === item.id} aria-controls={removing?.id === item.id ? `clearing-remove-${item.id}` : undefined} onClick={() => { setRemoveError(""); setEditing(null); setRemoving(removing?.id === item.id ? null : { id: item.id, reason: "" }); }}>Remove</Button>}</td>
    </tr>
    {editing?.id === item.id && <tr className="border-t bg-primary/5"><td colSpan={7} className="p-3">
      <form className="space-y-3 text-sm" onSubmit={(event) => { event.preventDefault(); if (!busy && editing.branch && editing.employeeId) void saveEdit(); }}>
        <p className="font-medium">Correct the clearing of {item.employeeName || item.employeeId} ({item.clearedDate})</p>
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr] md:items-end">
          <div className="space-y-1"><Label>Branch *</Label><SearchSelect aria-label="Branch" className="h-9" value={editing.branch} onValueChange={(value) => setEditing({ ...editing, branch: value, employeeId: "" })} options={(data?.branches ?? []).map((branchItem) => ({ value: branchItem.name, label: branchItem.name }))} /></div>
          <div className="space-y-1"><Label>MAS / employee *</Label><SearchSelect aria-label="MAS or employee" className="h-9" disabled={!editing.branch} placeholder="Search name or ID" value={editing.employeeId} onValueChange={(value) => setEditing({ ...editing, employeeId: value })}
            options={(data?.employees ?? []).filter((person) => person.branchIds.includes(data?.branches.find((branchItem) => branchItem.name === editing.branch)?.id ?? "")).map((person) => ({ value: person.id, label: person.name, description: `${person.id} · ${person.roles.join(", ") || "No role"}` }))} /></div>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <legend className="mb-1 font-medium">Remitting *</legend>
          {([["Both", "New Sales and Collections"], ["New Sales", "New Sales only"], ["Collections", "Collections only"]] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name={`clearing-edit-covers-${item.id}`} checked={editing.covers === value} onChange={() => setEditing({ ...editing, covers: value })} />{label}</label>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">The branch and MAS can be changed only before anything is encoded for this clearing; a kind already encoded stays ticked.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !editing.branch || !editing.employeeId}>{busy ? "Saving..." : "Save changes"}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setEditError(""); }}>Cancel</Button>
        </div>
        {editError && <p role="alert" className="text-red-700 dark:text-red-400">{editError}</p>}
      </form>
    </td></tr>}
    {removing?.id === item.id && <tr className="border-t bg-amber-50 dark:bg-amber-950/30"><td colSpan={7} className="p-3">
      <form id={`clearing-remove-${item.id}`} className="space-y-3 text-sm" onSubmit={(event) => { event.preventDefault(); if (!busy && removing.reason.trim().length >= 3) void remove(); }}>
        <p className="font-medium">Remove clearing for {item.employeeName || item.employeeId} in {item.branch}?</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1"><Label htmlFor={`clearing-remove-reason-${item.id}`}>Reason for removing *</Label><Input id={`clearing-remove-reason-${item.id}`} autoFocus disabled={busy} minLength={3} maxLength={300} required placeholder="e.g. Listed the wrong MAS" value={removing.reason} onChange={(event) => setRemoving({ ...removing, reason: event.target.value })} /><p className="text-xs text-muted-foreground">Enter at least 3 characters, then confirm removal.</p></div>
          <Button type="submit" variant="destructive" disabled={busy || removing.reason.trim().length < 3}>{busy ? "Removing..." : "Remove clearing"}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setRemoving(null); setRemoveError(""); }}>Cancel</Button>
        </div>
        {removeError && <p role="alert" className="text-red-700 dark:text-red-400">{removeError}</p>}
      </form>
    </td></tr>}
    </Fragment>
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
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 md:col-span-5">
            <legend className="mb-1 text-sm font-medium">Remitting *</legend>
            {([["Both", "New Sales and Collections"], ["New Sales", "New Sales only"], ["Collections", "Collections only"]] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="clearing-covers" value={value} checked={covers === value} onChange={() => setCovers(value)} />{label}</label>)}
          </fieldset>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">The time is recorded when you press the button. The incentive is kept when this is by 3:00 PM the day after the OR date. Without a clearing, New Sales and Collections for that MAS, branch and day cannot be saved. Tick only what the person is remitting: only that can be encoded, and New Sales and Collections each show their own status, so a wrong New Sales batch does not hold back correct Collections.</p>
      </CardContent></Card>

      {message && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card><CardContent className="space-y-4 pt-4">
        <div className="overflow-x-auto border-b"><div className="flex min-w-max gap-1" role="tablist" aria-label="Clearing by status">
          {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={shownTab.id === item.id} onClick={() => setTab(item.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${shownTab.id === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
            {item.label}<span className={`rounded-full px-1.5 text-xs ${shownTab.id === item.id ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{item.items.length}</span>
          </button>)}
        </div></div>
        <p className="text-sm text-muted-foreground">{shownTab.id === "Approved today" ? "Every entry saved and approved (or the line removed). These leave the page after 11:59 PM." : "New Sales and Collections each move by themselves: Waiting for encoding → Waiting for receipt (bank or e-wallet batch saved, receipt photo not attached yet; cash skips this) → For approval → Approved. Returned means the approver sent that batch back: fix it in My Entries (Edit batch) and press Resubmit batch there. Edit on this page only corrects the clearing itself, and a saved batch edit stays Returned until it is resubmitted. A line ticked for both is under its least advanced kind. Lines from earlier days stay until everything ticked is approved."}</p>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/50"><tr>{["MAS / employee", "Branch", "Cleared", "Amount", "Notes", "Status", ""].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{shownTab.items.map(row)}{!shownTab.items.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{data ? `Nothing ${shownTab.id === "Approved today" ? "approved today" : `in ${shownTab.label}`}.` : "Loading..."}</td></tr>}</tbody></table></div>
      </CardContent></Card>
    </section>
  );
}
