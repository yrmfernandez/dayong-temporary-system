"use client";

import { AlertTriangle, Eye, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import { formatDeadline } from "@/lib/remittance-deadline";
import { TODAY_MODE_LABELS, TODAY_MODES, type TodayMode } from "@/lib/today-mode";
import type { DayEntry } from "@/lib/todays-entries";
import { EntryCorrectionForm } from "@/components/entry-correction-form";
import { EntryDetails } from "@/components/entry-details";
import { AdminDeletePanel } from "@/components/admin-delete";
import { ReceiptPhotoUpload, ReceiptPhotoView } from "@/components/receipt-photo";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Totals = { count: number; amount: number; incentives: number; forfeited: number };
type Result = { success: boolean; message?: string; date: string; today: string; mode: TodayMode; defaultMode: TodayMode; canEdit: boolean; canDelete?: boolean; employeeId: string; entries: DayEntry[]; sales: Totals; collections: Totals };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const MODE_HELP: Record<TodayMode, string> = {
  remittance: "Cash the office received on a remittance slip that day.",
  encoded: "Entries saved in the system that day.",
  or: "Entries whose OR date is that day.",
};

export default function TodaysEntriesPage() {
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<TodayMode | "">("");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);

  const load = useCallback(async (nextDate: string, nextMode: TodayMode | "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextDate) params.set("date", nextDate);
      if (nextMode) params.set("mode", nextMode);
      const response = await fetch(`/api/todays-entries?${params}`, { cache: "no-store" });
      const result = await parseJsonResponse<Result>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load entries.");
      setData(result);
      setDate(result.date);
      setMode(result.mode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load uses today and the company default
    void load("", "");
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["sales", "collections", "members", "system_settings"], () => load(date, mode));

  const changeView = (nextDate: string, nextMode: TodayMode | "") => { setEditing(""); setMessage(""); void load(nextDate, nextMode); };

  const saveDefault = async (value: TodayMode) => {
    setSavingDefault(true); setMessage("");
    try {
      const response = await fetch("/api/todays-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: value }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the setting.");
      setMessage(result.message ?? "Saved.");
      await load(date, mode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the setting.");
    } finally {
      setSavingDefault(false);
    }
  };

  const sales = data?.entries.filter((entry) => entry.kind === "New Sale") ?? [];
  const collections = data?.entries.filter((entry) => entry.kind === "Collection") ?? [];
  const isToday = data && data.date === data.today;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{isToday || !data ? "Today's Entries" : `Entries for ${data.date}`}</h1>
        <p className="text-sm text-muted-foreground">New Sales and Collections for the day. Incentives are kept only when the cash is received by 3:00 PM the day after the OR date. Encoding closes at 3:00 PM.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="entries-date">Date</Label>
              <Input id="entries-date" type="date" max={data?.today} value={date} onChange={(event) => event.target.value && changeView(event.target.value, mode)} />
            </div>
            <div className="space-y-2">
              <Label>Count &quot;today&quot; by</Label>
              <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="group" aria-label="Count today by">
                {TODAY_MODES.map((item) => (
                  <Button key={item} type="button" size="sm" variant={mode === item ? "default" : "ghost"} onClick={() => changeView(date, item)}>
                    {TODAY_MODE_LABELS[item]}{data?.defaultMode === item ? " (default)" : ""}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => changeView(date, mode)} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          </div>
          {data?.canEdit && (
            <div className="space-y-2">
              <Label htmlFor="default-mode">Default for everyone (and dashboards)</Label>
              <select id="default-mode" className="h-9 rounded-md border bg-background px-3 text-sm" value={data.defaultMode} disabled={savingDefault} onChange={(event) => void saveDefault(event.target.value as TodayMode)}>
                {TODAY_MODES.map((item) => <option key={item} value={item}>{TODAY_MODE_LABELS[item]}</option>)}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      {mode && <p className="text-sm text-muted-foreground">{MODE_HELP[mode]}</p>}
      {message && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</p>}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile tone="brand" label="New Sales" value={data.sales.count} detail={money(data.sales.amount)} />
          <MetricTile tone="info" label="Collections" value={data.collections.count} detail={money(data.collections.amount)} />
          <MetricTile tone="success" label="Incentives kept" value={money(data.sales.incentives + data.collections.incentives)} detail="MAS and Collector incentives" />
          <MetricTile tone="danger" label="Incentives forfeited" value={money(data.sales.forfeited + data.collections.forfeited)} detail="Remitted after the deadline" />
        </div>
      )}

      {data && (
        <>
          <EntryTable title="New Sales" entries={sales} canEdit={data.canEdit} canDelete={Boolean(data.canDelete)} me={data.employeeId} editing={editing} setEditing={setEditing} onSaved={(text) => { setMessage(text); setEditing(""); void load(date, mode); }} />
          <EntryTable title="Collections" entries={collections} canEdit={data.canEdit} canDelete={Boolean(data.canDelete)} me={data.employeeId} editing={editing} setEditing={setEditing} onSaved={(text) => { setMessage(text); setEditing(""); void load(date, mode); }} />
        </>
      )}
    </div>
  );
}

function EntryTable({ title, entries, canEdit, canDelete, me, editing, setEditing, onSaved }: {
  title: string; entries: DayEntry[]; canEdit: boolean; canDelete: boolean; me: string; editing: string; setEditing: (id: string) => void; onSaved: (message: string) => void;
}) {
  // `editing` holds "view:<id>", "edit:<id>" or "delete:<id>" for the row whose panel is open.
  const columns = 9;
  const toggle = (panel: string) => setEditing(editing === panel ? "" : panel);
  return (
    <Card>
      <CardHeader><CardTitle>{title} <span className="font-normal text-muted-foreground">({entries.length})</span></CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">Entry</th><th className="p-3">Member</th><th className="p-3">Program · Branch</th><th className="p-3">MAS / Collector</th><th className="p-3">OR</th><th className="p-3 text-right">Amount</th><th className="p-3">Incentive</th><th className="p-3">Remittance</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className="border-t align-top">
                    <td className="p-3"><span className="block font-mono text-xs">{entry.id}</span><span className="block text-xs text-muted-foreground">{entry.encodedAt} · {entry.encodedBy || "Not recorded"}</span>{entry.warnings.length > 0 && <button type="button" onClick={() => setEditing(`view:${entry.id}`)} className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"><AlertTriangle className="size-3" />Check dates ({entry.warnings.length})</button>}</td>
                    <td className="p-3"><span className="block">{entry.memberName || "—"}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                    <td className="p-3"><span className="block">{entry.program}</span><span className="block text-xs text-muted-foreground">{entry.branch}</span></td>
                    <td className="p-3">{entry.person}</td>
                    <td className="p-3"><span className="block">{entry.orNumber || (entry.applicationNumber ? `App ${entry.applicationNumber}` : "—")}</span><span className="block text-xs text-muted-foreground">{entry.orDate}</span>{entry.dateRemitted && <span className="block text-xs text-muted-foreground">Remitted {entry.dateRemitted}</span>}</td>
                    <td className="p-3 text-right font-medium">{money(entry.amount)}</td>
                    <td className="p-3">
                      {entry.forfeitedIncentive > 0
                        ? <><StatusBadge status={`Forfeited ${money(entry.forfeitedIncentive)}`} tone="danger" /><span className="block text-xs text-muted-foreground">Cash came in after {formatDeadline(entry.incentiveDeadline)}</span></>
                        : entry.incentive > 0
                          ? <><span className="block">{money(entry.incentive)}</span><span className="block text-xs text-muted-foreground">{entry.onRemittance ? "Kept" : `Remit by ${formatDeadline(entry.incentiveDeadline)}`}</span></>
                          : <span className="text-xs text-muted-foreground">None</span>}
                    </td>
                    <td className="p-3"><StatusBadge status={entry.remittanceStatus || "Not set"} />{entry.remittedAt && <span className="block text-xs text-muted-foreground">Received {entry.remittedAt}</span>}{entry.remittanceId && <span className="block font-mono text-[11px] text-muted-foreground">{entry.remittanceId}</span>}</td>
                    <td className="p-3"><div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => toggle(`view:${entry.id}`)}><Eye className="size-3.5" />View</Button>
                      {canEdit && <Button type="button" size="sm" variant="outline" onClick={() => toggle(`edit:${entry.id}`)}><Pencil className="size-3.5" />Edit</Button>}
                      {canDelete && <Button type="button" size="sm" variant="outline" className="text-red-700 dark:text-red-400" onClick={() => toggle(`delete:${entry.id}`)}><Trash2 className="size-3.5" />Delete</Button>}
                    </div>
                    {/* Receipt photo: the clerk who encoded it, or an administrator, can add it any time. */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {entry.photoId ? <ReceiptPhotoView photoId={entry.photoId} label="Receipt" /> : <span className="text-xs font-medium text-amber-800">No receipt photo</span>}
                      {(canEdit || entry.encodedByEmployeeId === me) && <ReceiptPhotoUpload entryIds={[entry.id]} replace={Boolean(entry.photoId)} onSaved={onSaved} />}
                    </div></td>
                  </tr>
                  {editing === `view:${entry.id}` && <tr className="border-t bg-muted/20"><td colSpan={columns} className="p-3"><EntryDetails entry={entry} onClose={() => setEditing("")} /></td></tr>}
                  {canDelete && editing === `delete:${entry.id}` && <tr className="border-t bg-muted/20"><td colSpan={columns} className="p-3"><AdminDeletePanel kind={entry.kind === "New Sale" ? "sale" : "collection"} id={entry.id} onCancel={() => setEditing("")} onDeleted={onSaved} /></td></tr>}
                  {canEdit && editing === `edit:${entry.id}` && <tr className="border-t bg-muted/20"><td colSpan={columns} className="p-3"><EntryCorrectionForm entry={entry} endpoint="/api/todays-entries" onCancel={() => setEditing("")} onSaved={onSaved} /></td></tr>}
                </Fragment>
              ))}
              {!entries.length && <tr><td colSpan={columns} className="p-8 text-center text-muted-foreground">No {title} for this day.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
