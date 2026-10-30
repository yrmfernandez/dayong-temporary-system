"use client";

import { mamStatusClass } from "@/components/mam-status";
import { Badge } from "@/components/ui/badge";
import { formatDate as showDate, formatMonth } from "@/lib/date-format";
import type { buildMamReport } from "@/lib/mam-report";

type Row = ReturnType<typeof buildMamReport>["rows"][number];

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * A member account's payment card (owner, October 30, 2026): today's standing in plain terms (paid up to, next month
 * due, months behind, amount due, last payment, suspension and forfeit dates), then every receipt, newest first.
 */
export function MamMemberCard({ row }: { row: Row }) {
  const now = row.current;
  const done = now && ["Fully Paid", "Forfeited"].includes(now.status);
  const facts: Array<[string, React.ReactNode]> = now ? [
    ["Paid up to", now.lastCoveredMonth ? formatMonth(now.lastCoveredMonth) : "New Sale only"],
    ...(done ? [] : [["Next month due", `${formatMonth(now.nextMonth)} · ${money(now.monthlyAmount)}`] as [string, React.ReactNode]]),
    ["Months behind", now.unpaidMonths ? `${now.unpaidMonths}` : "None"],
    ["Amount due now", now.balance === null ? "—" : money(now.balance)],
    ["Last payment", now.latestOrDate ? `${showDate(now.latestOrDate)}${now.latestOrNumber ? ` · OR ${now.latestOrNumber}` : ""}` : "None yet"],
    ...(done ? [] : [
      ["Suspended from", showDate(now.suspendedAt)] as [string, React.ReactNode],
      ["Forfeits on", showDate(now.forfeitedAt)] as [string, React.ReactNode],
    ]),
  ] : [];
  const receipts = [...row.history].sort((a, b) => b.orDate.localeCompare(a.orDate));

  return <div className="space-y-6">
    <div>
      <h3 className="text-xl font-bold">{row.memberName}</h3>
      <p className="font-mono text-sm text-muted-foreground">{row.memberNumber}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{row.programName}</Badge>
        {now && <Badge className={`border font-mono text-[10px] ${mamStatusClass(now.status)}`}>{now.status}</Badge>}
        {now?.temporarilySuspended && <Badge className="border border-amber-300 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">Suspended · waiver needed</Badge>}
      </div>
    </div>

    {now ? <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border bg-muted/20 p-4 text-sm">
      {facts.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="text-right font-medium">{value}</dd>
      </div>)}
    </dl> : <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"><span className="font-semibold">Needs review:</span> {row.currentError || "The account could not be worked out."}</p>}

    <div className="space-y-2 rounded-lg border p-4 text-sm">
      {([["MAS", row.mas], ["Branch", row.branch], ["Date of issuance", showDate(row.doi)], ["Application no.", row.applicationNumber || "—"], ["Monthly", money(row.basePay)]] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span>
      </div>)}
    </div>

    <div>
      <h4 className="mb-3 text-sm font-semibold">Receipts ({receipts.length}), newest first</h4>
      {receipts.length ? <div className="space-y-3">
        {receipts.map((p) => <div key={p.id} className="space-y-1 rounded-lg border bg-card p-3 text-xs">
          <div className="flex justify-between text-sm font-bold">
            <span>{money(p.amount)}</span>
            <span className="text-xs font-normal text-muted-foreground">{showDate(p.orDate)}</span>
          </div>
          <p className="font-mono text-muted-foreground">OR #{p.orNumber}</p>
          <div className="mt-1 border-t pt-1.5 text-muted-foreground">
            Covers: {p.monthFrom === p.monthTo ? formatMonth(p.monthFrom) : `${formatMonth(p.monthFrom)} – ${formatMonth(p.monthTo)}`} (NOP {p.nopFrom}{p.nopTo !== p.nopFrom ? `–${p.nopTo}` : ""})
          </div>
          <div className="text-muted-foreground">Remitted: {showDate(p.dateRemitted) || "Not yet"}</div>
        </div>)}
      </div> : <p className="text-sm italic text-muted-foreground">No payments recorded yet.</p>}
    </div>
  </div>;
}
