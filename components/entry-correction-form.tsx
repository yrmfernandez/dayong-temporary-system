"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";

/** The fields a correction needs; Today's Entries rows and Exceptions items both provide them. */
export type CorrectableEntry = { kind: "New Sale" | "Collection"; id: string; orNumber: string; orDate: string; amount: number; applicationNumber: string; notes: string; onRemittance: boolean };

/**
 * Administrator correction of a New Sale or Collection with a required reason (Record Corrections). OR number and date
 * can always be fixed; the amount only while the entry is not on a remittance slip.
 */
export function EntryCorrectionForm({ entry, endpoint, onCancel, onSaved }: { entry: CorrectableEntry; endpoint: string; onCancel: () => void; onSaved: (message: string) => void }) {
  const isSale = entry.kind === "New Sale";
  const [orNumber, setOrNumber] = useState(entry.orNumber);
  const [orDate, setOrDate] = useState(entry.orDate);
  const [amount, setAmount] = useState(String(entry.amount));
  const [applicationNumber, setApplicationNumber] = useState(entry.applicationNumber);
  const [notes, setNotes] = useState(entry.notes);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      const body = isSale
        ? { id: entry.id, module: "New Sales", reason, applicationNumber, amountPaid: Number(amount), notes, orNumber, orDate }
        : { id: entry.id, module: "Collections", reason, orNumber, orDate, amountCollected: Number(amount) };
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to correct the entry.");
      onSaved(result.message ?? "Saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to correct the entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isSale && <div className="space-y-1"><Label htmlFor={`app-${entry.id}`}>Application no.</Label><Input id={`app-${entry.id}`} value={applicationNumber} onChange={(event) => setApplicationNumber(event.target.value)} /></div>}
        <div className="space-y-1"><Label htmlFor={`or-${entry.id}`}>OR number</Label><Input id={`or-${entry.id}`} value={orNumber} onChange={(event) => setOrNumber(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor={`ordate-${entry.id}`}>OR date</Label><Input id={`ordate-${entry.id}`} type="date" value={orDate} onChange={(event) => setOrDate(event.target.value)} /></div>
        <div className="space-y-1">
          <Label htmlFor={`amount-${entry.id}`}>Amount</Label>
          <Input id={`amount-${entry.id}`} type="number" min="0" step="0.01" value={amount} disabled={entry.onRemittance} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setAmount(event.target.value)} />
          {entry.onRemittance && <p className="text-xs text-muted-foreground">On a remittance slip; correct the amount through reconciliation.</p>}
        </div>
        {isSale && <div className="space-y-1 sm:col-span-2"><Label htmlFor={`notes-${entry.id}`}>Notes</Label><Input id={`notes-${entry.id}`} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>}
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`reason-${entry.id}`}>Reason for the correction *</Label><Input id={`reason-${entry.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. OR date typed with the wrong year" /></div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || reason.trim().length < 3} onClick={() => void save()}>{saving ? "Saving..." : "Save Correction"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
