"use client";

import { AlertTriangle, CheckCircle2, ListChecks, Wallet } from "lucide-react";

import { mamStatusClass } from "@/components/mam-status";
import { MetricTile } from "@/components/metric-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate as showDate, formatMonth } from "@/lib/date-format";
import { collectionList, monthsLabel } from "@/lib/mas-collection";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

type Row = Parameters<typeof collectionList>[0][number];

/**
 * A MAS's collection list for this month (owner, October 30, 2026): who still owes, how much, and who is close to
 * forfeiting, most urgent first. Tapping a member opens their payment card.
 */
export function MasCollectionList<T extends Row>({ rows, today, onOpen }: { rows: T[]; today: string; onOpen: (row: T) => void }) {
  const list = collectionList(rows, today);
  return <Card className="rounded-3xl border-violet-90 shadow-[0_4px_20px_-2px_rgb(45_28_89_/_0.05)]">
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-lg"><ListChecks className="h-5 w-5" /> To collect in {formatMonth(list.month)}</CardTitle>
      <p className="text-sm text-muted-foreground">Your members who still owe this month, the ones closest to forfeiting first. Tap a member for their payment card.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile tone="warning" icon={Wallet} label="To collect" value={money(list.toCollect)} detail={`${list.owing.length} member${list.owing.length === 1 ? "" : "s"} to visit`} />
        <MetricTile tone="danger" icon={AlertTriangle} label="Close to forfeiting" value={String(list.closeToForfeit)} detail="Forfeits within a month" />
        <MetricTile tone="success" icon={CheckCircle2} label="Collected this month" value={money(list.collected)} detail={`${list.paidThisMonth} member${list.paidThisMonth === 1 ? "" : "s"} paid`} />
        <MetricTile tone="neutral" icon={AlertTriangle} label="Forfeited" value={String(list.forfeited)} detail="Need reactivation" />
      </div>
      {list.owing.length ? <ul className="grid gap-2 md:grid-cols-2">
        {list.owing.map((item) => <li key={item.row.id}>
          <button type="button" onClick={() => onOpen(item.row)} className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 ${item.closeToForfeit ? "border-rose-300 bg-rose-500/5" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{item.row.memberName}</p>
                <p className="truncate text-xs text-muted-foreground">{item.row.memberNumber} · {item.row.programName}</p>
              </div>
              <Badge className={`shrink-0 border font-mono text-[10px] ${mamStatusClass(item.status)}`}>{item.status}</Badge>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                <p>{item.months} month{item.months === 1 ? "" : "s"}: {monthsLabel(item.from, item.to)}</p>
                <p>Last paid: {item.lastPaid ? `${showDate(item.lastPaid)}${item.lastOr ? ` (OR ${item.lastOr})` : ""}` : "no payment yet"}</p>
              </div>
              <p className="text-lg font-bold tabular-nums">{money(item.toCollect)}</p>
            </div>
            {(item.closeToForfeit || item.waiverNeeded) && <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-400">
              {item.closeToForfeit ? `Forfeits ${showDate(item.forfeitsOn)}${item.daysToForfeit > 0 ? ` (in ${item.daysToForfeit} day${item.daysToForfeit === 1 ? "" : "s"})` : ""}` : ""}
              {item.closeToForfeit && item.waiverNeeded ? " · " : ""}{item.waiverNeeded ? "Suspended: waiver needed" : ""}
            </p>}
          </button>
        </li>)}
      </ul> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Everyone is paid through {formatMonth(list.month)}. Nothing left to collect this month.</p>}
    </CardContent>
  </Card>;
}
