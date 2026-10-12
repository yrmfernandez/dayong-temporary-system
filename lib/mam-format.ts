/**
 * What a MAM month's own receipts paid (owner, October 12, 2026): the NOP range and the months they cover. A month with
 * no receipt shows nothing, instead of repeating the month before. One old-sheet receipt can cover several NOPs and
 * months, so both are ranges.
 */
type Receipt = { monthFrom: string; monthTo: string; nopFrom: number; nopTo: number };

const label = (month: string) => /^\d{4}-\d{2}$/.test(month)
  ? new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))
  : month;

export function paidInMonth(receipts: Receipt[]) {
  const nops = receipts.flatMap((receipt) => [receipt.nopFrom, receipt.nopTo]).filter((nop) => Number.isFinite(nop) && nop > 0);
  const months = receipts.flatMap((receipt) => [receipt.monthFrom, receipt.monthTo]).filter((month) => /^\d{4}-\d{2}$/.test(month)).sort();
  const low = nops.length ? Math.min(...nops) : 0, high = nops.length ? Math.max(...nops) : 0;
  return {
    nop: !nops.length ? "" : low === high ? String(low) : `${low}-${high}`,
    monthOf: !months.length ? "" : months[0] === months.at(-1) ? label(months[0]) : `${label(months[0])} – ${label(months.at(-1)!)}`,
  };
}
