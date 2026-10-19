"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import type { EditableEntry, EditKind } from "@/lib/entry-edit";

const field = "w-full rounded-md border bg-background p-2 text-sm";
const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * Full edit of one New Sale or Collection in Edit / Corrections (owner, October 15, 2026; lib/entry-edit.ts): the
 * program or account, receipt numbers and dates, amount, months paid, Date Remitted, method and notes, with a required
 * reason. Remitted entries can be edited; their slip's expected amount follows.
 */
export function EntryEditor({ kind, id, onCancel, onSaved }: { kind: EditKind; id: string; onCancel: () => void; onSaved: (message: string) => void }) {
  const [entry, setEntry] = useState<EditableEntry | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/entry-corrections?${new URLSearchParams({ kind, id })}`, { cache: "no-store", signal: controller.signal })
      .then((response) => parseJsonResponse<{ success: boolean; message?: string; entry: EditableEntry }>(response))
      .then((result) => {
        if (!result.success) throw new Error(result.message || "Unable to load the entry.");
        const v = result.entry.values;
        setEntry(result.entry);
        setForm({
          enrollmentId: v.enrollmentId, programId: v.programId, orNumber: v.orNumber, orDate: v.orDate, amount: String(v.amount), dateRemitted: v.dateRemitted,
          months: String(Math.max(1, v.nopTo - v.nopFrom + 1)), applicationNumber: v.applicationNumber, notes: v.notes, paymentMethod: v.paymentMethod, doiTime: v.doiTime,
        });
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load the entry."); });
    return () => controller.abort();
  }, [kind, id]);

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/entry-corrections", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, reason, ...form }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the entry.");
      onSaved(result.message ?? "Saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save the entry."); }
    finally { setSaving(false); }
  }

  if (!entry) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-muted-foreground">Loading the entry...</p>;
  const v = entry.values;
  const own = new Set(entry.accounts.map((account) => account.programId));
  const chosenAccount = entry.accounts.find((account) => account.enrollmentId === form.enrollmentId);
  const movingAccount = kind === "Collection" && form.enrollmentId !== v.enrollmentId;
  const changingProgram = kind === "New Sale" && form.programId !== v.programId;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
      <div>
        <p className="font-semibold">Edit {kind} <span className="font-mono text-xs text-muted-foreground">{entry.id}</span></p>
        <p className="text-muted-foreground">{entry.member.name || "—"} · {entry.member.number} · {entry.branch} · {entry.person}</p>
        {kind === "Collection" && <p className="text-muted-foreground">Now: NOP {v.nopFrom}{v.nopTo > v.nopFrom ? `–${v.nopTo}` : ""} ({v.monthFrom}{v.monthTo !== v.monthFrom ? ` to ${v.monthTo}` : ""}) · {peso(v.amount)}</p>}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.remittance.onSlip ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{entry.remittance.status}{entry.remittance.slipId ? ` · ${entry.remittance.slipId}` : ""}</span>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kind === "Collection"
        ? <div className="space-y-1 sm:col-span-2"><Label>Account (program) it pays</Label>
            <select className={field} value={form.enrollmentId} onChange={set("enrollmentId")}>
              {entry.accounts.map((account) => <option key={account.enrollmentId} value={account.enrollmentId}>{account.program} · {account.branch} · {account.mas} · DOI {account.doi || "—"} · ₱{account.rate}{account.flexible ? " min" : ""}/month{account.status ? ` · ${account.status}` : ""}</option>)}
            </select></div>
        : <div className="space-y-1 sm:col-span-2"><Label>Program</Label>
            <select className={field} value={form.programId} onChange={set("programId")}>
              {entry.programs.filter((program) => program.active || program.id === v.programId).map((program) => <option key={program.id} value={program.id}>{program.name} · ₱{program.rate}{own.has(program.id) && program.id !== v.programId ? " · member already has this account" : ""}</option>)}
            </select></div>}
      {kind === "New Sale" && <div className="space-y-1"><Label>Application no.</Label><Input value={form.applicationNumber} onChange={set("applicationNumber")} /></div>}
      <div className="space-y-1"><Label>OR number</Label><Input value={form.orNumber} onChange={set("orNumber")} /></div>
      <div className="space-y-1"><Label>{kind === "New Sale" ? "Application date" : "OR date"}</Label><Input type="date" value={form.orDate} onChange={set("orDate")} /></div>
      {kind === "New Sale" && <div className="space-y-1"><Label>DOI time</Label><Input type="time" value={form.doiTime ?? ""} onChange={set("doiTime")} /></div>}
      <div className="space-y-1"><Label>Amount</Label><Input type="number" min="0" step="0.01" value={form.amount} onWheel={(event) => event.currentTarget.blur()} onChange={set("amount")} /></div>
      {kind === "Collection" && <div className="space-y-1"><Label>Months paid</Label><Input type="number" min="1" max="120" step="1" value={form.months} onWheel={(event) => event.currentTarget.blur()} onChange={set("months")} /></div>}
      <div className="space-y-1"><Label>Date Remitted</Label><Input type="date" value={form.dateRemitted} onChange={set("dateRemitted")} /></div>
      {kind === "New Sale" && <div className="space-y-1"><Label>Remittance method</Label>
        <select className={field} value={form.paymentMethod} onChange={set("paymentMethod")}>{[...new Set([v.paymentMethod, ...entry.paymentMethods].filter(Boolean))].map((name) => <option key={name}>{name}</option>)}</select></div>}
      {kind === "New Sale" && <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={set("notes")} /></div>}
    </div>

    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
      {movingAccount && <li>The payment moves to {chosenAccount?.program}. Both accounts&apos; payments are numbered again in OR-date order, and both must still pass the account rules.</li>}
      {kind === "Collection" && !movingAccount && <li>Changing the OR date or the months paid numbers the account&apos;s payments again in OR-date order.</li>}
      {changingProgram && <li>The member&apos;s account and its collections move with the New Sale to the new program; its payments must fit the new monthly rate.</li>}
      {entry.remittance.onSlip && <li>This entry is on remittance slip {entry.remittance.slipId}. If its company share changes, the slip&apos;s expected amount changes and the slip shows the difference against the cash received.</li>}
      <li>A change of amount, months or program works out the incentive and company share again; fixing a number or date keeps them. Every change is kept in the Audit Log and Record Corrections.</li>
    </ul>

    <div className="space-y-1"><Label htmlFor={`edit-reason-${id}`}>Reason for the correction *</Label><Input id={`edit-reason-${id}`} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Clerk chose D-350 instead of DPB-350; receipt confirms DPB-350" /></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-2">
      <Button type="button" size="sm" disabled={saving || reason.trim().length < 3} onClick={() => void save()}>{saving ? "Saving..." : "Save changes"}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}
