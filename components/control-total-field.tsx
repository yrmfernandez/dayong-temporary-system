"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cashCountTotal, controlTotalStatus, DENOMINATIONS, TURNOVER_NOTE_MAX, varianceLabel, type CashCounts } from "@/lib/entry-controls";

const TONE = { problem: "text-red-700", match: "text-emerald-700", variance: "text-amber-700" } as const;

/**
 * The control total in a New Sales or Collections save bar (owner, October 29, 2026). It shows whether the turnover
 * sheet matches the batch's total remittance or is short or over by how much. Short or over still saves; the optional
 * note goes with the recorded difference (lib/turnover-variance.ts) to help whoever settles it.
 *
 * Cash batches (owner, November 27, 2026): `cash` turns it into Cash counted, the cash the clerk counted from the MAS,
 * compared with the expected cash (`totalRemittance` is then total remittance + penalty; lib/entry-controls.ts).
 * It is counted by denomination: the pieces of each bill and coin, and the total is worked out from them.
 */
export function ControlTotalField({ id, title, value, onChange, note, onNoteChange, totalRemittance, cash = false, counts = {}, onCountsChange }: {
  id: string; title: string; value: string; onChange: (value: string) => void;
  note: string; onNoteChange: (value: string) => void; totalRemittance: number | null; cash?: boolean;
  counts?: CashCounts; onCountsChange?: (counts: CashCounts) => void;
}) {
  if (cash) return <CashCountField id={id} counts={counts} onCountsChange={onCountsChange ?? (() => undefined)} note={note} onNoteChange={onNoteChange} expected={totalRemittance} />;
  const status = value === "" ? null : controlTotalStatus(value, totalRemittance, cash);
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

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const BILLS = DENOMINATIONS.filter((denomination) => denomination >= 20);
const COINS = DENOMINATIONS.filter((denomination) => denomination < 20);

/**
 * Cash counted by denomination (owner, November 27, 2026): how many ₱1,000, ₱500, ₱100 … the MAS handed over for the
 * batch, with Fidelity and any penalty in it. It sits in the sticky save bar, so it stays one line there (total counted,
 * expected cash, short / over) and the counter opens above it on Count cash: bills and coins in two even columns, every
 * subtotal always shown so nothing jumps while typing, whole pieces only (digits).
 */
function CashCountField({ id, counts, onCountsChange, note, onNoteChange, expected }: {
  id: string; counts: CashCounts; onCountsChange: (counts: CashCounts) => void;
  note: string; onNoteChange: (value: string) => void; expected: number | null;
}) {
  const [open, setOpen] = useState(false);
  const total = cashCountTotal(counts);
  const status = total ? controlTotalStatus(total, expected, true) : null;
  const short = status?.tone === "variance" ? varianceLabel(status.difference) : status?.tone === "match" ? "Matches" : "";
  return (
    <div className="w-full space-y-2 lg:w-auto">
      {open && (
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border bg-background p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Count the cash by denomination</p>
            <span className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={!total} onClick={() => onCountsChange({})}>Clear</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Done</Button>
            </span>
          </div>
          <DenominationCounter id={id} counts={counts} onCountsChange={onCountsChange} />
          <p className="mt-2 text-xs text-muted-foreground">Everything the MAS handed over for this batch, with Fidelity and any penalty.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Label htmlFor={open ? `${id}-1000` : id} className="whitespace-nowrap">Cash counted *</Label>
        <Button id={id} type="button" size="sm" variant={total ? "outline" : "default"} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="tabular-nums">
          {total ? peso(total) : "Count cash"}{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </Button>
        {expected !== null && <span className="whitespace-nowrap text-muted-foreground">Expected <strong className="tabular-nums text-foreground">{peso(expected)}</strong></span>}
        {short && <span className={`whitespace-nowrap font-medium ${TONE[status!.tone]}`} title={status!.text}>{short}</span>}
      </div>
      {status?.tone === "variance" && <p className={`text-xs ${TONE.variance}`}>{status.text}</p>}
      {status?.tone === "variance" && (
        <Input aria-label="Cash count note" className="w-full max-w-md" maxLength={TURNOVER_NOTE_MAX} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Note on the short/over (optional), e.g. MAS to pay tomorrow" />
      )}
    </div>
  );
}

/**
 * The pieces of each bill and coin, bills and coins in two even columns, every subtotal always shown; whole pieces only.
 * Used by Cash counted and by the Mark remitted window (components/mark-remitted-dialog.tsx). The ₱1,000 box has the
 * ID `${id}-1000`.
 */
export function DenominationCounter({ id, counts, onCountsChange }: { id: string; counts: CashCounts; onCountsChange: (counts: CashCounts) => void }) {
  const row = (denomination: number) => {
    const key = String(denomination), pieces = Number(counts[key]) || 0;
    return (
      <label key={key} className="grid grid-cols-[3.75rem_4.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
        <span className="text-right font-medium tabular-nums">₱{denomination.toLocaleString("en-PH")}</span>
        <Input id={denomination === 1000 ? `${id}-1000` : undefined} type="text" inputMode="numeric" autoComplete="off" maxLength={6} className="h-8 px-2 text-right tabular-nums" value={String(counts[key] ?? "")} placeholder="0"
          onChange={(event) => onCountsChange({ ...counts, [key]: event.target.value.replace(/\D/g, "") })} aria-label={`Pieces of ₱${denomination}`} />
        <span className={`text-right tabular-nums ${pieces ? "" : "text-muted-foreground/60"}`}>{peso(pieces * denomination)}</span>
      </label>
    );
  };
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bills</p>{BILLS.map(row)}</div>
      <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Coins</p>{COINS.map(row)}</div>
    </div>
  );
}
