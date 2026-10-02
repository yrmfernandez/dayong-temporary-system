"use client";

const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);

/**
 * The batch calculation shown on Collections and New Sales:
 *   total incentives = amount collected - company remittance
 *   total remittance = company remittance + Fidelity
 * `remittance` is null while an entry is incomplete. Fidelity is the employee's own money handed over with the batch, so it
 * is added to the remittance without touching incentives. A penalty (also the MAS's own money) is shown separately below.
 */
export function RemittanceSummary({ collected, remittance, fidelity = 0, penalty = 0, penaltyNote = "", incentiveNote }: {
  collected: number; remittance: number | null; fidelity?: number; penalty?: number; penaltyNote?: string; incentiveNote?: string;
}) {
  const ready = remittance !== null;
  const incentives = ready ? Math.round((collected - remittance) * 100) / 100 : 0;
  const total = ready ? Math.round((remittance + fidelity) * 100) / 100 : 0;
  const row = "flex items-baseline justify-between gap-3";
  return <section aria-label="Remittance calculation" className="space-y-2 rounded-xl border bg-primary/5 p-4 text-sm">
    <div className={row}><span className="font-medium">Total amount collected</span><strong className="tabular-nums">{peso(collected)}</strong></div>
    <div className={row}>
      <span className="font-medium">Total incentives{incentiveNote && <span className="block text-xs font-normal text-muted-foreground">{incentiveNote}</span>}</span>
      <strong className="tabular-nums">{ready ? peso(incentives) : "Pending"}</strong>
    </div>
    {ready && fidelity > 0 && <div className="ml-3 space-y-0.5 border-l-2 pl-3 text-xs text-muted-foreground">
      <div className={row}><span>Company remittance</span><span className="tabular-nums">{peso(remittance)}</span></div>
      <div className={`${row} text-emerald-700`}><span>+ Fidelity (employee&apos;s own money)</span><span className="tabular-nums">{peso(fidelity)}</span></div>
    </div>}
    <div className={`${row} border-t pt-2 text-base`}><span className="font-semibold">Total remittance</span><strong className="tabular-nums">{ready ? peso(total) : "Complete the entries"}</strong></div>
    {penalty > 0 && <div className="space-y-1 border-t border-dashed pt-2 text-xs">
      <p className="text-muted-foreground">Separate from the remittance</p>
      <div className={`${row} text-red-700`}><span>Penalty (MAS&apos;s own money){penaltyNote && <span className="block">{penaltyNote}</span>}</span><strong className="tabular-nums">{peso(penalty)}</strong></div>
    </div>}
  </section>;
}
