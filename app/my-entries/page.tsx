"use client";

import { AlertTriangle, Eye, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { EntryDetails } from "@/components/entry-details";
import { MetricTile } from "@/components/metric-tile";
import { ReceiptPhotoUpload, ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import type { DayEntry } from "@/lib/todays-entries";

type Totals = { count: number; amount: number };
type Result = { success: boolean; message?: string; from: string; to: string; today: string; employeeId: string; isAdmin: boolean; clerks: Array<{ employeeId: string; name: string }>; entries: DayEntry[]; sales: Totals; collections: Totals; withPhoto: number };
type Period = "today" | "week" | "month" | "custom";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const todayInManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function rangeFor(period: Period, today: string): [string, string] {
  if (period === "week") { const start = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)); return [start, shift(start, 6)]; }
  if (period === "month") return [`${today.slice(0, 7)}-01`, new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10)];
  return [today, today];
}

export default function MyEntriesPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor("today", todayInManila()));
  const [employeeId, setEmployeeId] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState("");

  const load = useCallback(async (nextFrom: string, nextTo: string, nextEmployee: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo, ...(nextEmployee ? { employeeId: nextEmployee } : {}) });
      const response = await fetch(`/api/my-entries?${params}`, { cache: "no-store" });
      const result = await parseJsonResponse<Result>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load your entries.");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load your entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the chosen period
    void load(from, to, employeeId);
  }, [load, from, to, employeeId]);

  const choose = (next: Period) => { setPeriod(next); setSelected([]); if (next !== "custom") setRange(rangeFor(next, todayInManila())); };
  const saved = (text: string) => { setMessage(text); setSelected([]); void load(from, to, employeeId); };
  const entries = data?.entries ?? [];
  const missing = entries.filter((entry) => !entry.photoId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Entries</h1>
        <p className="text-sm text-muted-foreground">The New Sales and Collections you encoded, by the date you encoded them. Attach a photo of each receipt; a remittance cannot be approved until every item on it has one. One photo can cover several entries: tick them and use Attach one photo.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="group" aria-label="Period">
              {([["today", "Today"], ["week", "This week"], ["month", "This month"], ["custom", "Choose dates"]] as const).map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={period === value ? "default" : "ghost"} onClick={() => choose(value)}>{label}</Button>
              ))}
            </div>
            {period === "custom" && (
              <>
                <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} max={to} onChange={(event) => event.target.value && setRange([event.target.value, to])} /></div>
                <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} min={from} onChange={(event) => event.target.value && setRange([from, event.target.value])} /></div>
              </>
            )}
            {data?.isAdmin && (
              <div className="space-y-1">
                <Label htmlFor="clerk">Entry Clerk</Label>
                <select id="clerk" className="h-9 rounded-md border bg-background px-3 text-sm" value={employeeId || data.employeeId} onChange={(event) => { setSelected([]); setEmployeeId(event.target.value); }}>
                  {!data.clerks.some((clerk) => clerk.employeeId === data.employeeId) && <option value={data.employeeId}>Me</option>}
                  {data.clerks.map((clerk) => <option key={clerk.employeeId} value={clerk.employeeId}>{clerk.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load(from, to, employeeId)}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </CardContent>
      </Card>

      {message && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</p>}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile tone="brand" label="New Sales" value={data.sales.count} detail={money(data.sales.amount)} />
          <MetricTile tone="info" label="Collections" value={data.collections.count} detail={money(data.collections.amount)} />
          <MetricTile tone={missing.length ? "warning" : "success"} label="Receipt photos" value={`${data.withPhoto} of ${entries.length}`} detail={missing.length ? `${missing.length} still need a photo` : "All attached"} />
          <MetricTile tone="neutral" label="Period" value={from === to ? from : `${from} to ${to}`} detail="By date encoded" />
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Entries ({entries.length})</CardTitle>
            <p className="text-sm text-muted-foreground">Newest first. Tick entries that share one receipt, then attach one photo to all of them.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {missing.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(missing.map((entry) => entry.id))}>Select all without a photo</Button>}
            {selected.length > 0 && <ReceiptPhotoUpload entryIds={selected} label={`Attach one photo to ${selected.length} selected`} onSaved={saved} />}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-3"><span className="sr-only">Select</span></th><th className="p-3">Entry</th><th className="p-3">Member</th><th className="p-3">MAS / Collector</th><th className="p-3">OR / Application</th><th className="p-3 text-right">Amount</th><th className="p-3">Remittance</th><th className="p-3">Receipt photo</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="border-t align-top">
                      <td className="p-3"><input type="checkbox" aria-label={`Select ${entry.id}`} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} /></td>
                      <td className="p-3">
                        <span className="block text-xs font-semibold">{entry.kind}</span>
                        <span className="block font-mono text-xs">{entry.id}</span>
                        <span className="block text-xs text-muted-foreground">Encoded {entry.encodedAt}</span>
                        {entry.warnings.length > 0 && <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900"><AlertTriangle className="size-3" />Check dates ({entry.warnings.length})</span>}
                      </td>
                      <td className="p-3"><span className="block">{entry.memberName || "—"}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                      <td className="p-3">{entry.person}<span className="block text-xs text-muted-foreground">{entry.branch}</span></td>
                      <td className="p-3"><span className="block">{entry.orNumber || (entry.applicationNumber ? `App ${entry.applicationNumber}` : "—")}</span><span className="block text-xs text-muted-foreground">{entry.orDate}</span>{entry.dateRemitted && <span className="block text-xs text-muted-foreground">Remitted {entry.dateRemitted}</span>}</td>
                      <td className="p-3 text-right font-medium">{money(entry.amount)}</td>
                      <td className="p-3"><StatusBadge status={entry.remittanceStatus || "Not set"} /></td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {entry.photoId ? <><StatusBadge status="Attached" tone="success" /><ReceiptPhotoView photoId={entry.photoId} label="View" /></> : <StatusBadge status="Missing" tone="warning" />}
                          <ReceiptPhotoUpload entryIds={[entry.id]} replace={Boolean(entry.photoId)} onSaved={saved} />
                        </div>
                      </td>
                      <td className="p-3"><Button type="button" size="sm" variant="outline" onClick={() => setOpen(open === entry.id ? "" : entry.id)}><Eye className="size-3.5" />View</Button></td>
                    </tr>
                    {open === entry.id && <tr className="border-t bg-muted/20"><td colSpan={9} className="p-3"><EntryDetails entry={entry} onClose={() => setOpen("")} /></td></tr>}
                  </Fragment>
                ))}
                {!entries.length && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">{loading ? "Loading..." : "Nothing encoded in this period."}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
