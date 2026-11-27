"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cashCountTotal, controlTotalStatus, DENOMINATIONS, TURNOVER_NOTE_MAX, type CashCounts } from "@/lib/entry-controls";

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

/**
 * Cash counted by denomination (owner, November 27, 2026): how many ₱1,000, ₱500, ₱100 … the MAS handed over for the
 * batch, with Fidelity and any penalty in it. Each row shows its subtotal; the total is compared with the expected cash.
 */
function CashCountField({ id, counts, onCountsChange, note, onNoteChange, expected }: {
  id: string; counts: CashCounts; onCountsChange: (counts: CashCounts) => void;
  note: string; onNoteChange: (value: string) => void; expected: number | null;
}) {
  const total = cashCountTotal(counts);
  const status = total ? controlTotalStatus(total, expected, true) : null;
  return (
    <fieldset className="space-y-2 rounded-lg border p-2">
      <legend className="px-1 text-sm font-medium" title="Count the cash the MAS handed over for this batch, with Fidelity and any penalty: type how many of each bill and coin.">Cash counted *</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
        {DENOMINATIONS.map((denomination) => {
          const key = String(denomination), pieces = Number(counts[key]) || 0;
          return (
            <label key={key} className="flex items-center gap-1 text-xs">
              <span className="w-12 shrink-0 text-right font-medium tabular-nums">₱{denomination.toLocaleString("en-PH")}</span>
              <span className="text-muted-foreground">×</span>
              <Input id={denomination === 1000 ? id : undefined} type="number" min="0" step="1" inputMode="numeric" className="h-8 w-16 px-2" value={String(counts[key] ?? "")} placeholder="0"
                onWheel={(event) => event.currentTarget.blur()} onChange={(event) => onCountsChange({ ...counts, [key]: event.target.value })} aria-label={`Pieces of ₱${denomination}`} />
              {pieces > 0 && <span className="truncate text-muted-foreground tabular-nums">{peso(pieces * denomination)}</span>}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>Total counted <strong className="tabular-nums">{peso(total)}</strong></span>
        {expected !== null && <span className="text-muted-foreground">Expected cash <strong className="tabular-nums text-foreground">{peso(expected)}</strong></span>}
        {!total && <span className="text-xs text-red-700">Count the cash by denomination.</span>}
        {status && <span className={`max-w-96 text-xs ${TONE[status.tone]}`}>{status.text}</span>}
      </div>
      {status?.tone === "variance" && (
        <Input aria-label="Cash count note" className="w-full max-w-md" maxLength={TURNOVER_NOTE_MAX} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Note on the short/over (optional), e.g. MAS to pay tomorrow" />
      )}
    </fieldset>
  );
}
