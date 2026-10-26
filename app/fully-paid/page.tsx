"use client";

import { useCallback, useEffect, useState } from "react";
import { Award } from "lucide-react";

import { promptDialog } from "@/components/app-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayInManila } from "@/lib/account-rules";
import { readApiResponse } from "@/lib/api-response";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate as showDate } from "@/lib/date-format";

type Item = { enrollmentId: string; memberNumber: string | null; memberName: string; program: string; branch: string | null; paidOn: string | null; total: number; source: string | null; recordedBy: string | null;
  certificate: string | null; certificateStatus: string | null; releasedOn: string | null; releasedBy: string | null };
type Prefix = { id: string; name: string; prefix: string | null; territory: string | null };
type RecordAccount = { enrollmentId: string; program: string; branch: string | null; doi: string | null; status: string | null; total: number | null };
const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const field = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/**
 * Fully Paid (owner, October 27, 2026): every Fully Paid account with its certificate; certificates to release; record a
 * full payment by hand (the certificate number is given automatically, AREA + YEAR + "-" + sequence); and each branch's
 * certificate prefix. Accounts whose receipts complete the program are recorded by themselves (lib/full-payments.ts).
 */
export default function FullyPaidPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [prefixes, setPrefixes] = useState<Prefix[]>([]);
  const [filters, setFilters] = useState({ search: "", branch: "", status: "" });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState({ member: "", enrollmentId: "", paidOn: todayInManila(), total: "", certificateNumber: "" });
  const [recordAccounts, setRecordAccounts] = useState<RecordAccount[]>([]);
  const [editedPrefix, setEditedPrefix] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const result = await readApiResponse(await fetch(`/api/fully-paid?${params}`, { cache: "no-store" })) as { success: boolean; message?: string; items: Item[]; prefixes: Prefix[] };
      if (!result.success) throw new Error(result.message || "Unable to load.");
      setItems(result.items); setPrefixes(result.prefixes);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load."); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list for the chosen filters
    void load();
  }, [load]);
  useLiveRefresh(["member_programs", "branches"], load, 3000);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try {
      const result = await readApiResponse(await fetch("/api/fully-paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })) as { success: boolean; message?: string };
      setMessage(result.message || (result.success ? "Saved." : "Unable to save."));
      if (result.success) await load();
      return result.success;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); return false; }
    finally { setBusy(false); }
  };

  const release = async (item: Item) => {
    const releasedOn = await promptDialog(`Date certificate ${item.certificate} was released (YYYY-MM-DD)`, { defaultValue: todayInManila() });
    if (!releasedOn) return;
    const receivedBy = await promptDialog("Who received it? (member or claimant; leave blank for yourself)", { defaultValue: "" });
    if (receivedBy === null) return;
    await post({ action: "release", enrollmentId: item.enrollmentId, releasedOn, receivedBy });
  };
  const remove = async (item: Item) => {
    const reason = await promptDialog(`Remove the full payment of ${item.memberNumber} (${item.program})? Its status is worked out from the receipts again. Reason:`, { defaultValue: "" });
    if (reason) await post({ action: "remove", enrollmentId: item.enrollmentId, reason });
  };
  const findAccounts = async () => {
    setMessage(""); setRecordAccounts([]);
    try {
      const result = await readApiResponse(await fetch(`/api/fully-paid?member=${encodeURIComponent(record.member.trim())}`, { cache: "no-store" })) as { success: boolean; message?: string; accounts: RecordAccount[] };
      if (!result.success) throw new Error(result.message || "Unable to load.");
      setRecordAccounts(result.accounts);
      if (!result.accounts.length) setMessage("No account of that member number left to record (none, or all already Fully Paid).");
      else setRecord((current) => ({ ...current, enrollmentId: result.accounts[0].enrollmentId, total: String(result.accounts[0].total ?? "") }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load."); }
  };

  const pending = items.filter((item) => item.certificateStatus !== "Released").length;
  const branchNames = prefixes.map((item) => item.name);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Award className="size-6 text-primary" />Fully Paid</h1>
        <p className="text-sm text-muted-foreground">Accounts that completed their program, with their certificates. An account becomes Fully Paid by itself when its receipts complete the program; record one by hand below. A Fully Paid account has nothing due, never falls behind and takes no more payments.</p>
      </div>
      {message && <p role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</p>}

      <Card>
        <CardHeader><CardTitle>Fully Paid accounts ({items.length}{pending ? ` · ${pending} certificate${pending === 1 ? "" : "s"} to release` : ""})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="fp-search">Search</Label><Input id="fp-search" placeholder="Member number, name or certificate" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fp-branch">Branch</Label><select id="fp-branch" className={field} value={filters.branch} onChange={(event) => setFilters({ ...filters, branch: event.target.value })}><option value="">All branches</option>{branchNames.map((name) => <option key={name}>{name}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="fp-status">Certificate</Label><select id="fp-status" className={field} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Any</option><option value="Pending">To release</option><option value="Released">Released</option></select></div>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : !items.length ? <p className="text-sm text-muted-foreground">No Fully Paid accounts match.</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-2">Member</th><th className="p-2">Program · branch</th><th className="p-2">Fully paid</th><th className="p-2">Certificate</th><th className="p-2"></th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.enrollmentId} className="border-b align-top">
                <td className="p-2"><strong>{item.memberName || "—"}</strong><div className="text-xs text-muted-foreground">{item.memberNumber} · {item.enrollmentId}</div></td>
                <td className="p-2">{item.program}<div className="text-xs text-muted-foreground">{item.branch}</div></td>
                <td className="p-2">{showDate(item.paidOn)} · {peso(item.total)}<div className="text-xs text-muted-foreground">{item.source}{item.recordedBy ? ` · ${item.recordedBy}` : ""}</div></td>
                <td className="p-2"><span className="font-mono">{item.certificate}</span> <StatusBadge status={item.certificateStatus === "Released" ? "Released" : "To release"} tone={item.certificateStatus === "Released" ? "success" : "warning"} />
                  {item.certificateStatus === "Released" && <div className="text-xs text-muted-foreground">{showDate(item.releasedOn)}{item.releasedBy ? ` · to ${item.releasedBy}` : ""}</div>}</td>
                <td className="p-2 text-right"><div className="flex flex-wrap justify-end gap-2">
                  {item.certificateStatus === "Released"
                    ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "pending", enrollmentId: item.enrollmentId })}>Mark pending</Button>
                    : <><Button type="button" size="sm" disabled={busy} onClick={() => void release(item)}>Release</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(item)}>Remove</Button></>}
                </div></td>
              </tr>)}</tbody>
            </table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Record a full payment</CardTitle><p className="text-xs text-muted-foreground">For a member who completed their program but whose receipts are not all in the system. Leave the certificate number blank to give the next one for the branch&apos;s area.</p></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="fp-member">Member number</Label><Input id="fp-member" className="w-48" placeholder="PH-…" value={record.member} onChange={(event) => setRecord({ ...record, member: event.target.value })} /></div>
            <Button type="button" variant="outline" disabled={!record.member.trim()} onClick={() => void findAccounts()}>Find accounts</Button>
          </div>
          {recordAccounts.length > 0 && <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void post({ action: "record", enrollmentId: record.enrollmentId, paidOn: record.paidOn, total: Number(record.total), certificateNumber: record.certificateNumber }).then((ok) => { if (ok) { setRecordAccounts([]); setRecord({ member: "", enrollmentId: "", paidOn: todayInManila(), total: "", certificateNumber: "" }); } }); }}>
            <div className="space-y-1 lg:col-span-2"><Label htmlFor="fp-account">Account</Label><select id="fp-account" className={field} value={record.enrollmentId} onChange={(event) => setRecord({ ...record, enrollmentId: event.target.value, total: String(recordAccounts.find((item) => item.enrollmentId === event.target.value)?.total ?? "") })}>
              {recordAccounts.map((item) => <option key={item.enrollmentId} value={item.enrollmentId}>{item.program} · {item.branch} · DOI {showDate(item.doi)} · {item.status || "—"}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="fp-date">Date of full payment</Label><Input id="fp-date" type="date" max={todayInManila()} value={record.paidOn} onChange={(event) => setRecord({ ...record, paidOn: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fp-total">Total paid</Label><Input id="fp-total" type="number" min="0" step="0.01" value={record.total} onChange={(event) => setRecord({ ...record, total: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fp-cert">Certificate number (blank: automatic)</Label><Input id="fp-cert" placeholder="e.g. DAVAO2026-039" value={record.certificateNumber} onChange={(event) => setRecord({ ...record, certificateNumber: event.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" disabled={busy || !record.enrollmentId || !(Number(record.total) > 0)}>Record Fully Paid</Button></div>
          </form>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Certificate prefixes</CardTitle><p className="text-xs text-muted-foreground">The area at the start of each branch&apos;s certificate numbers (DAVAO2026-038). Numbers count per area and year.</p></CardHeader>
        <CardContent><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{prefixes.map((item) => {
          const value = editedPrefix[item.id] ?? item.prefix ?? "";
          return <div key={item.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <span className="min-w-0 flex-1 truncate"><strong>{item.name}</strong><span className="block text-xs text-muted-foreground">{item.territory || "—"}</span></span>
            <Input aria-label={`Certificate prefix for ${item.name}`} className="h-8 w-28 uppercase" placeholder="None" value={value} onChange={(event) => setEditedPrefix({ ...editedPrefix, [item.id]: event.target.value })} />
            <Button type="button" size="sm" variant="outline" disabled={busy || value.toUpperCase() === (item.prefix ?? "")} onClick={() => void post({ action: "prefix", branchId: item.id, prefix: value }).then((ok) => { if (ok) setEditedPrefix((current) => { const next = { ...current }; delete next[item.id]; return next; }); })}>Save</Button>
          </div>;
        })}</div></CardContent>
      </Card>
    </section>
  );
}
