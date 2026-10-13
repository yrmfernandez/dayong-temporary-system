"use client";

import { Pencil, Save, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import type { EditableBatch } from "@/lib/batch-edit";

type Entry = EditableBatch["entries"][number] & { remove: boolean; amountText: string };
type Method = { name: string; isCash: boolean; status: string };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const monthsBetween = (from: string, to: string) => (/^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && to >= from ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1 : 0);
const field = "h-8 text-sm";

/**
 * Edit a batch the approver returned (lib/batch-edit.ts): the batch details and every entry, as encoded, or remove an
 * entry. Saving keeps the batch Returned; the clerk resubmits it from My Entries.
 */
export function BatchEditor({ entryIds, onClose, onSaved }: { entryIds: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [batch, setBatch] = useState<EditableBatch | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [form, setForm] = useState({ dateRemitted: "", dateRemittedReason: "", paymentMethod: "", paymentReference: "", collectedBy: "MAS", penalty: "", penaltyNote: "", fidelity: "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // A new array arrives on every render of My Entries; the batch reloads only when its entries change.
  const idsKey = entryIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [batchResponse, methodResponse] = await Promise.all([
          fetch(`/api/my-entries/batch?ids=${encodeURIComponent(idsKey)}`, { cache: "no-store", signal: controller.signal }),
          fetch("/api/remittance-methods", { cache: "no-store", signal: controller.signal }),
        ]);
        const result = await parseJsonResponse<{ success: boolean; message?: string; batch: EditableBatch }>(batchResponse);
        if (!batchResponse.ok || !result.success) throw new Error(result.message || "Unable to open the batch.");
        const methodResult = await methodResponse.json().catch(() => ({ methods: [] }));
        setMethods(((methodResult.methods ?? []) as Method[]).filter((method) => method.status === "active"));
        const loaded = result.batch;
        setBatch(loaded);
        setEntries(loaded.entries.map((entry) => ({ ...entry, remove: false, amountText: String(entry.amount) })));
        setForm({ dateRemitted: loaded.dateRemitted, dateRemittedReason: "", paymentMethod: loaded.paymentMethod, paymentReference: loaded.paymentReference, collectedBy: loaded.collectedBy || "MAS",
          penalty: loaded.penalty ? String(loaded.penalty) : "", penaltyNote: loaded.penaltyNote, fidelity: loaded.fidelity ? String(loaded.fidelity) : "", note: "" });
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to open the batch.");
      }
    })();
    return () => controller.abort();
  }, [idsKey]);

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const change = (id: string, patch: Partial<Entry>) => setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  const kept = entries.filter((entry) => !entry.remove);
  const total = kept.reduce((sum, entry) => sum + (Number(entry.amountText) || 0), 0);
  const isSale = batch?.kind === "New Sale";
  // A changed Date Remitted needs a clearing that covers it and a reason (owner, October 13, 2026).
  const dateRemittedChanged = Boolean(batch && form.dateRemitted !== batch.dateRemitted);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/my-entries/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ids: entryIds, ...form, penalty: Number(form.penalty) || 0, fidelity: Number(form.fidelity) || 0,
        entries: entries.map((entry) => ({ id: entry.id, remove: entry.remove, orNumber: entry.orNumber, orDate: entry.orDate, amount: Number(entry.amountText), monthTo: entry.monthTo,
          backdateReason: entry.backdateReason, applicationNumber: entry.applicationNumber, notes: entry.notes })),
      }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the batch.");
      onSaved(result.message || "Saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the batch.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t bg-amber-50/40 p-3 dark:bg-amber-500/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-semibold"><Pencil className="size-4" />Edit returned batch</p>
          <p className="text-xs text-muted-foreground">Fix what the approver pointed out, then save. Member and program stay as they are; to change them, remove the entry and encode it again. The batch stays Returned until you press Resubmit batch.</p>
          {batch?.returnReason && <p className="mt-1 text-xs text-red-700">Returned: {batch.returnReason}</p>}
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Close editor" onClick={onClose}><X className="size-4" /></Button>
      </div>

      {!batch && !error && <p className="text-sm text-muted-foreground">Loading the batch...</p>}
      {batch && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="edit-date-remitted">Date Remitted</Label>
              <Input id="edit-date-remitted" type="date" className={field} value={form.dateRemitted} onChange={(event) => set("dateRemitted", event.target.value)} />
              {dateRemittedChanged
                ? <Input aria-label="Reason for changing the Date Remitted" className={field} maxLength={300} placeholder="Why was the Date Remitted changed? *" value={form.dateRemittedReason} onChange={(event) => set("dateRemittedReason", event.target.value)} />
                : batch.dateRemittedReason && <p className="text-xs text-muted-foreground">Changed before: {batch.dateRemittedReason}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-method">Remittance method</Label>
              <select id="edit-method" className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)}>
                {!methods.some((method) => method.name === form.paymentMethod) && <option value={form.paymentMethod}>{form.paymentMethod}</option>}
                {methods.map((method) => <option key={method.name} value={method.name}>{method.name}</option>)}
              </select>
            </div>
            {!isSale && <div className="space-y-1"><Label htmlFor="edit-reference">Reference (optional)</Label><Input id="edit-reference" className={field} value={form.paymentReference} onChange={(event) => set("paymentReference", event.target.value)} /></div>}
            {!isSale && (
              <div className="space-y-1">
                <Label htmlFor="edit-collected-by">Collected by</Label>
                <select id="edit-collected-by" className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={form.collectedBy} onChange={(event) => set("collectedBy", event.target.value)}>
                  <option value="MAS">MAS</option><option value="Collector">Collector</option><option value="DTO">DTO (Direct to Office)</option>
                </select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="edit-penalty">Penalty</Label><Input id="edit-penalty" type="number" min="0" step="0.01" className={field} value={form.penalty} onChange={(event) => set("penalty", event.target.value)} /></div>
            {Number(form.penalty) > 0 && <div className="space-y-1"><Label htmlFor="edit-penalty-note">Penalty is for</Label><Input id="edit-penalty-note" className={field} value={form.penaltyNote} onChange={(event) => set("penaltyNote", event.target.value)} /></div>}
            <div className="space-y-1"><Label htmlFor="edit-fidelity">Fidelity</Label><Input id="edit-fidelity" type="number" min="0" step="0.01" className={field} value={form.fidelity} onChange={(event) => set("fidelity", event.target.value)} /></div>
          </div>

          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Member</th>
                  {isSale ? <><th className="p-2">Application no.</th><th className="p-2">Application date</th></> : <><th className="p-2">OR number</th><th className="p-2">OR date</th><th className="p-2">Months</th></>}
                  <th className="p-2">Amount</th>
                  {isSale && <th className="p-2">Notes</th>}
                  <th className="p-2">Late-entry reason</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const months = monthsBetween(entry.monthFrom, entry.monthTo);
                  return (
                    <tr key={entry.id} className={`border-t align-top ${entry.remove ? "opacity-50" : ""}`}>
                      <td className="p-2"><span className="block font-medium">{entry.memberName || entry.memberNumber}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber} · {entry.program}</span>{entry.remove && <span className="text-xs font-semibold text-red-700">Will be removed</span>}</td>
                      {isSale ? (
                        <>
                          <td className="p-2"><Input aria-label="Application number" className={field} disabled={entry.remove} value={entry.applicationNumber} onChange={(event) => change(entry.id, { applicationNumber: event.target.value })} /></td>
                          <td className="p-2"><Input aria-label="Application date" type="date" className={field} disabled={entry.remove} value={entry.orDate} onChange={(event) => change(entry.id, { orDate: event.target.value })} /></td>
                        </>
                      ) : (
                        <>
                          <td className="p-2"><Input aria-label="OR number" className={`${field} w-28`} disabled={entry.remove} value={entry.orNumber} onChange={(event) => change(entry.id, { orNumber: event.target.value })} /></td>
                          <td className="p-2"><Input aria-label="OR date" type="date" className={field} disabled={entry.remove} value={entry.orDate} onChange={(event) => change(entry.id, { orDate: event.target.value })} /></td>
                          <td className="p-2">
                            <div className="flex items-center gap-1 text-xs"><span>{entry.monthFrom} to</span><Input aria-label="Last month paid" type="month" min={entry.monthFrom} className={`${field} w-36`} disabled={entry.remove} value={entry.monthTo} onChange={(event) => change(entry.id, { monthTo: event.target.value })} /></div>
                            <span className="text-xs text-muted-foreground">{months ? `NOP ${entry.nopFrom}${months > 1 ? `-${entry.nopFrom + months - 1}` : ""} · ${months} month${months === 1 ? "" : "s"} · at least ${money(entry.basePay * months)}` : "Choose the last month paid"}</span>
                          </td>
                        </>
                      )}
                      <td className="p-2"><Input aria-label="Amount" type="number" min="0" step="0.01" className={`${field} w-28`} disabled={entry.remove} value={entry.amountText} onChange={(event) => change(entry.id, { amountText: event.target.value })} /></td>
                      {isSale && <td className="p-2"><Input aria-label="Notes" className={field} disabled={entry.remove} value={entry.notes} onChange={(event) => change(entry.id, { notes: event.target.value })} /></td>}
                      <td className="p-2"><Input aria-label="Late-entry reason" className={field} placeholder="Only if the date is late" disabled={entry.remove} value={entry.backdateReason} onChange={(event) => change(entry.id, { backdateReason: event.target.value })} /></td>
                      <td className="p-2 text-right">
                        <Button type="button" size="sm" variant="ghost" onClick={() => change(entry.id, { remove: !entry.remove })}>
                          {entry.remove ? <><Undo2 className="size-3.5" />Keep</> : <><Trash2 className="size-3.5" />Remove</>}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-md space-y-1"><Label htmlFor="edit-note">What you fixed (optional)</Label><Input id="edit-note" className={field} placeholder="e.g. corrected OR number of the second receipt" value={form.note} onChange={(event) => set("note", event.target.value)} /></div>
            <div className="flex items-center gap-3">
              <span className="text-sm">{kept.length} entr{kept.length === 1 ? "y" : "ies"} · <strong>{money(total)}</strong></span>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={saving || !kept.length} onClick={() => void save()}><Save className="size-4" />{saving ? "Saving..." : "Save changes"}</Button>
            </div>
          </div>
        </>
      )}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
