"use client";

import { useState } from "react";

import { OrNoLetterCheck } from "@/components/or-no-letter-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import type { EntryField } from "@/lib/exception-fix";

/** The fields a correction needs; Today's Entries rows and Exceptions items both provide them. */
export type CorrectableEntry = { kind: "New Sale" | "Collection"; id: string; orNumber: string; orDate: string; amount: number; applicationNumber: string; notes: string; onRemittance: boolean };

/**
 * Administrator correction of a New Sale or Collection with a required reason (Record Corrections). OR number and date
 * can always be fixed; the amount only while the entry is not on a remittance slip. `fields` shows only what an issue is
 * about (Exceptions, lib/exception-fix.ts); the rest stays behind Show all fields.
 */
export function EntryCorrectionForm({ entry, endpoint, fields, onCancel, onSaved }: { entry: CorrectableEntry; endpoint: string; fields?: EntryField[]; onCancel: () => void; onSaved: (message: string) => void }) {
  const isSale = entry.kind === "New Sale";
  const [showAll, setShowAll] = useState(false);
  const shown = (name: EntryField) => showAll || !fields || fields.includes(name);
  const [orNumber, setOrNumber] = useState(entry.orNumber);
  const [orDate, setOrDate] = useState(entry.orDate);
  const [amount, setAmount] = useState(String(entry.amount));
  const [applicationNumber, setApplicationNumber] = useState(entry.applicationNumber);
  const [notes, setNotes] = useState(entry.notes);
  const [reason, setReason] = useState("");
  const [noLetter, setNoLetter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      const body = isSale
        ? { id: entry.id, module: "New Sales", reason, applicationNumber, amountPaid: Number(amount), notes, orNumber, orDate }
        : { id: entry.id, module: "Collections", reason, orNumber, orDate, amountCollected: Number(amount), orNoLetter: noLetter };
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
        {isSale && shown("applicationNumber") && <div className="space-y-1"><Label htmlFor={`app-${entry.id}`}>Application no.</Label><Input id={`app-${entry.id}`} value={applicationNumber} onChange={(event) => setApplicationNumber(event.target.value)} /></div>}
        {shown("orNumber") && <div className="space-y-1"><Label htmlFor={`or-${entry.id}`}>OR number</Label><Input id={`or-${entry.id}`} value={orNumber} onChange={(event) => setOrNumber(event.target.value)} />
          {!isSale && <OrNoLetterCheck orNumber={orNumber} checked={noLetter} onChange={setNoLetter} />}</div>}
        {shown("orDate") && <div className="space-y-1"><Label htmlFor={`ordate-${entry.id}`}>{isSale ? "Application date" : "OR date"}</Label><Input id={`ordate-${entry.id}`} type="date" value={orDate} onChange={(event) => setOrDate(event.target.value)} /></div>}
        {shown("amount") && <div className="space-y-1">
          <Label htmlFor={`amount-${entry.id}`}>Amount</Label>
          <Input id={`amount-${entry.id}`} type="number" min="0" step="0.01" value={amount} disabled={entry.onRemittance} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setAmount(event.target.value)} />
          {entry.onRemittance && <p className="text-xs text-muted-foreground">On a remittance slip; correct the amount through reconciliation.</p>}
        </div>}
        {isSale && shown("notes") && <div className="space-y-1 sm:col-span-2"><Label htmlFor={`notes-${entry.id}`}>Notes</Label><Input id={`notes-${entry.id}`} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>}
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`reason-${entry.id}`}>Reason for the correction *</Label><Input id={`reason-${entry.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. OR date typed with the wrong year" /></div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || reason.trim().length < 3} onClick={() => void save()}>{saving ? "Saving..." : "Save Correction"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {fields && !showAll && <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all fields</Button>}
      </div>
    </div>
  );
}
