const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * What the system worked out for one Collection or New Sale, on its card, so the clerk can check it there (owner,
 * November 5, 2026). Incentive and remittance are null until they can be worked out. `basis` says how the incentive was
 * reached (incentiveBasis). The figures come from the same rules the server saves with (lib/remittance.ts).
 */
export function EntryFigures({ account, nop, collected, incentive, remittance, basis = [], incentiveLabel = "Incentive" }: { account: string; nop: string; collected: number; incentive: number | null; remittance: number | null; basis?: string[]; incentiveLabel?: string }) {
  const money = (value: number | null) => value === null ? "Pending" : peso(value);
  return (
    <div className="text-xs text-muted-foreground">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        <div><dt>Account</dt><dd className="text-sm font-semibold text-foreground">{account}</dd></div>
        <div><dt>NOP</dt><dd className="text-sm font-semibold tabular-nums text-foreground">{nop}</dd></div>
        <div><dt>{incentiveLabel}</dt><dd className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(incentive)}</dd></div>
        <div><dt>Remittance</dt><dd className="text-sm font-semibold tabular-nums text-foreground">{money(remittance)}</dd></div>
      </dl>
      {basis.map((line) => <p key={line} className="mt-1 font-medium text-foreground">{line}</p>)}
      {incentive !== null && remittance !== null && <p className="mt-1 tabular-nums">{peso(collected)} collected − {peso(incentive)} incentive = {peso(remittance)} remittance</p>}
    </div>
  );
}
