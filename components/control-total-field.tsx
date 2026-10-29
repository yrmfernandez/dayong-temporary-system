"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { controlTotalStatus, TURNOVER_NOTE_MAX } from "@/lib/entry-controls";

const TONE = { problem: "text-red-700", match: "text-emerald-700", variance: "text-amber-700" } as const;

/**
 * The control total in a New Sales or Collections save bar (owner, October 29, 2026). It shows whether the turnover
 * sheet matches the batch's total remittance or is short or over by how much. Short or over still saves; the optional
 * note goes with the recorded difference (lib/turnover-variance.ts) to help whoever settles it.
 */
export function ControlTotalField({ id, title, value, onChange, note, onNoteChange, totalRemittance }: {
  id: string; title: string; value: string; onChange: (value: string) => void;
  note: string; onNoteChange: (value: string) => void; totalRemittance: number | null;
}) {
  const status = value === "" ? null : controlTotalStatus(value, totalRemittance);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap" title={title}>Control total *</Label>
      <Input id={id} type="number" min="0" step="0.01" className="w-36" value={value} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => onChange(event.target.value)} placeholder="From turnover sheet" />
      {status && <span className={`max-w-80 text-xs ${TONE[status.tone]}`}>{status.text}</span>}
      {status?.tone === "variance" && (
        <Input aria-label="Turnover note" className="w-72" maxLength={TURNOVER_NOTE_MAX} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Note on the short/over (optional), e.g. MAS to pay tomorrow" />
      )}
    </div>
  );
}
