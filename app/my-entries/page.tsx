"use client";

import { AlertTriangle, Eye, RefreshCw, Send } from "lucide-react";
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
import { useLiveRefresh } from "@/lib/use-live-refresh";

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
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["sales", "collections", "remittances"], () => load(from, to, employeeId));

  const choose = (next: Period) => { setPeriod(next); if (next !== "custom") setRange(rangeFor(next, todayInManila())); };
  const saved = (text: string) => { setMessage(text); void load(from, to, employeeId); };
  const entries = data?.entries ?? [];
  const batches = groupBatches(entries);
  const needPhoto = batches.filter((batch) => batch.needsPhoto);
  const returned = entries.filter((entry) => entry.remittanceStatus === "Returned");
  // Outstanding batches that are ready (cash, or every receipt attached) but were not sent: saved before cash went to approval on its own.
  const readyToSend = batches.filter((batch) => batch.readyToSend);
  const post = async (body: Record<string, unknown>, fallback: string) => {
    setMessage("");
    const response = await fetch("/api/my-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
    saved(result.message ?? (response.ok ? fallback : "Unable to save."));
  };
  const resubmit = (entryIds: string[]) => post({ entryIds }, "Resubmitted.");
  const send = (entryIds: string[]) => post({ entryIds, action: "submit" }, "Sent for approval.");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Entries</h1>
        <p className="text-sm text-muted-foreground">The New Sales and Collections you encoded, by the date you encoded them, one card per saved batch. A batch paid in cash goes to Pending Approval as soon as it is saved (the cash was counted at Clearing). A batch paid by bank or e-wallet needs one receipt photo for the whole batch; it then goes to Pending Approval on its own. Batches the approver returns show the reason; fix them and resubmit.</p>
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
                <select id="clerk" className="h-9 rounded-md border bg-background px-3 text-sm" value={employeeId || data.employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
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
          <MetricTile tone={needPhoto.length ? "warning" : "success"} label="Batches needing a receipt" value={needPhoto.length} detail={needPhoto.length ? "Bank or e-wallet batches without their photo" : `${batches.length} batch${batches.length === 1 ? "" : "es"}; none waiting`} />
          <MetricTile tone="neutral" label="Period" value={from === to ? from : `${from} to ${to}`} detail="By date encoded" />
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Batches ({batches.length}) · {entries.length} entr{entries.length === 1 ? "y" : "ies"}</CardTitle>
            <p className="text-sm text-muted-foreground">Newest first. The receipt photo and the remittance slip are per batch, not per member.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readyToSend.length > 0 && <Button type="button" size="sm" onClick={() => void send(readyToSend.flatMap((batch) => batch.entries.map((entry) => entry.id)))}><Send className="size-3.5" />Send ready batches for approval ({readyToSend.length})</Button>}
            {returned.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => void resubmit(returned.map((entry) => entry.id))}>Resubmit all returned ({returned.length})</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {batches.map((batch) => {
            const ids = batch.entries.map((entry) => entry.id);
            const first = batch.entries[0];
            const isReturned = batch.entries.some((entry) => entry.remittanceStatus === "Returned");
            return (
              <section key={batch.key} className={`overflow-hidden rounded-lg border ${batch.needsPhoto ? "border-amber-300" : isReturned ? "border-red-300" : ""}`} aria-label={`${batch.kind} batch`}>
                <div className="flex flex-wrap items-start justify-between gap-3 bg-muted/40 p-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold">{batch.kind === "New Sale" ? "New Sales" : "Collections"} batch · {batch.entries.length} entr{batch.entries.length === 1 ? "y" : "ies"} · {money(batch.total)}</p>
                    <p className="text-xs text-muted-foreground">{first.person} · {first.branch}{first.dateRemitted ? ` · remitted ${first.dateRemitted}` : ""} · encoded {first.encodedAt}{batch.methods.length ? ` · ${batch.methods.join(", ")}` : ""}</p>
                    {first.returnReason && <p className="text-xs text-red-700">Returned: {first.returnReason}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={batch.status} tone={batch.needsPhoto ? "warning" : isReturned ? "danger" : batch.status === "Remitted" ? "success" : "info"} />
                    {batch.allCash
                      ? <span className="text-xs text-muted-foreground">Cash · no receipt photo needed</span>
                      : <>
                        {batch.photoIds.map((photoId, index) => <ReceiptPhotoView key={photoId} photoId={photoId} label={batch.photoIds.length > 1 ? `Receipt ${index + 1}` : "View receipt"} />)}
                        {batch.canAttach && <ReceiptPhotoUpload entryIds={ids} label="Add receipt photo for this batch" replace={batch.photoIds.length > 0} onSaved={saved} />}
                      </>}
                    {batch.readyToSend && <Button type="button" size="sm" onClick={() => void send(ids)}><Send className="size-3.5" />Send for approval</Button>}
                    {isReturned && <Button type="button" size="sm" variant="outline" onClick={() => void resubmit(ids)}>Resubmit batch</Button>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2 pl-3">Entry</th><th className="p-2">Member</th><th className="p-2">OR / Application</th><th className="p-2">Method</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead>
                    <tbody>
                      {batch.entries.map((entry) => (
                        <Fragment key={entry.id}>
                          <tr className="border-t align-top">
                            <td className="p-2 pl-3"><span className="block font-mono text-xs">{entry.id}</span>{entry.warnings.length > 0 && <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900"><AlertTriangle className="size-3" />Check dates ({entry.warnings.length})</span>}</td>
                            <td className="p-2"><span className="block">{entry.memberName || "—"}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                            <td className="p-2"><span className="block">{entry.orNumber || (entry.applicationNumber ? `App ${entry.applicationNumber}` : "—")}</span><span className="block text-xs text-muted-foreground">{entry.orDate}</span></td>
                            <td className="p-2 text-xs">{entry.paymentMethod}</td>
                            <td className="p-2 text-right font-medium">{money(entry.amount)}</td>
                            <td className="p-2 text-right"><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === entry.id ? "" : entry.id)}><Eye className="size-3.5" />View</Button></td>
                          </tr>
                          {open === entry.id && <tr className="border-t bg-muted/20"><td colSpan={6} className="p-3"><EntryDetails entry={entry} onClose={() => setOpen("")} /></td></tr>}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          {!batches.length && <p className="p-8 text-center text-muted-foreground">{loading ? "Loading..." : "Nothing encoded in this period."}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

type Batch = { key: string; kind: DayEntry["kind"]; entries: DayEntry[]; total: number; methods: string[]; allCash: boolean; photoIds: string[]; status: string; needsPhoto: boolean; readyToSend: boolean; canAttach: boolean };

/**
 * Entries by saved batch (DayEntry.batchId; an imported entry is its own batch), newest first. A batch needs a receipt
 * photo when any of its Outstanding entries is not cash and has none; it is ready to send when every Outstanding entry
 * is cash or has its photo (lib/remittance-workflow.ts submitReadyEntries).
 */
function groupBatches(entries: DayEntry[]): Batch[] {
  const groups = new Map<string, DayEntry[]>();
  for (const entry of entries) { const key = entry.batchId || entry.id; groups.set(key, [...(groups.get(key) ?? []), entry]); }
  return [...groups].map(([key, list]) => {
    const outstanding = list.filter((entry) => entry.remittanceStatus === "Outstanding");
    const statuses = [...new Set(list.map((entry) => entry.remittanceStatus || "Not set"))];
    const needsPhoto = outstanding.some((entry) => !entry.cash && !entry.photoId);
    const label = (status: string) => status === "Pending Remittance Approval" ? "Pending approval" : status;
    const allCash = list.every((entry) => entry.cash);
    return {
      key, kind: list[0].kind, entries: list, total: Math.round(list.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100,
      methods: [...new Set(list.map((entry) => entry.paymentMethod).filter(Boolean))], allCash,
      photoIds: [...new Set(list.map((entry) => entry.photoId).filter(Boolean))],
      status: needsPhoto ? "Needs receipt photo" : statuses.length === 1 ? label(statuses[0]) : statuses.map(label).join(" / "),
      needsPhoto, readyToSend: outstanding.length > 0 && !needsPhoto,
      // A photo can be added or replaced until the batch is approved.
      canAttach: !allCash && list.some((entry) => entry.remittanceStatus !== "Remitted"),
    };
  });
}
