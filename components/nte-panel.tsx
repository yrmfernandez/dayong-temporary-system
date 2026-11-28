"use client";

import { promptDialog } from "@/components/app-dialog";
import { AlertTriangle, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/lib/use-live-refresh";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { readApiResponse } from "@/lib/api-response";
import type { Nte } from "@/lib/nte";
import { formatDate as showDate, formatDateTime as showDateTime } from "@/lib/date-format";

type Standing = { employeeId: string; employeeName: string; active: number; subjectToSuspension: boolean; nextExpiry: string };
type Data = { notices: Nte[]; standing: Standing[]; today: string; days: number; threshold: number };
type View = "active" | "review" | "unread" | "flagged" | "all";
const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const when = (value: string) => value ? showDateTime(value) : "";
const PAGE_SIZE = 15;

/** Explained but not yet marked reviewed by an administrator (the number beside Employees in the sidebar). */
export const needsReview = (nte: Nte) => Boolean(nte.explanation) && !nte.reviewedAt;
const unread = (nte: Nte) => nte.status === "Active" && !nte.acknowledgedAt;

/**
 * Notices to Explain, for administrators (the panel hides itself for anyone else). A notice is in force for 90 days;
 * an employee with 3 or more in force is flagged as subject to suspension. The employee sees the notice in My Notices;
 * the list shows whether they have read it and their explanation.
 *
 * Layout: counts that double as filters, the issue form only when asked for, and one short line per notice that
 * opens to show the details and the full explanation, 15 per page.
 */
export function NtePanel({ employees, onCounts }: { employees: Array<{ id: string; name: string }>; onCounts?: (counts: { review: number; flagged: number }) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<View>("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/nte", { cache: "no-store" });
      if (response.status === 403) { setAllowed(false); return; }
      const result = await readApiResponse(response);
      if (response.ok && result.success) setData(result as unknown as Data); else setMessage(result.message || "Unable to load notices.");
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to load notices. Check the connection and try again."); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the notices once
    void load();
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["notices_to_explain"], load);

  const notices = data?.notices ?? [];
  const flagged = data?.standing.filter((item) => item.subjectToSuspension) ?? [];
  const flaggedIds = new Set(flagged.map((item) => item.employeeId));
  const reviewCount = notices.filter(needsReview).length;
  useEffect(() => { onCounts?.({ review: reviewCount, flagged: flagged.length }); }, [onCounts, reviewCount, flagged.length]);
  if (!allowed) return null;

  const send = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/nte", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readApiResponse(response);
      setMessage(result.message || (response.ok ? "Saved." : "Unable to save."));
      if (response.ok && result.success) await load();
      return response.ok && result.success;
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to save. Check the connection and try again."); return false; }
    finally { setBusy(false); }
  };

  const views: Array<{ key: View; label: string; count: number; test: (nte: Nte) => boolean; tone?: string }> = [
    { key: "active", label: "In force", count: notices.filter((nte) => nte.status === "Active").length, test: (nte) => nte.status === "Active" },
    { key: "review", label: "Needs review", count: reviewCount, test: needsReview, tone: "text-amber-700" },
    { key: "unread", label: "Not yet read", count: notices.filter(unread).length, test: unread },
    { key: "flagged", label: "Subject to suspension", count: flagged.length, test: (nte) => nte.status === "Active" && flaggedIds.has(nte.employeeId), tone: "text-red-700" },
    { key: "all", label: "All, with expired and withdrawn", count: notices.length, test: () => true },
  ];
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const current = views.find((item) => item.key === view) ?? views[0];
  const shown = notices.filter((nte) => current.test(nte) && terms.every((term) => `${nte.employeeName} ${nte.employeeId} ${nte.reason}`.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const inForce = (id: string) => data?.standing.find((item) => item.employeeId === id)?.active ?? 0;

  return <section className="space-y-3 rounded-xl border bg-background p-4" aria-label="Notices to Explain">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Notices to Explain (NTE)</h2>
        <p className="text-sm text-muted-foreground">In force for {data?.days ?? 90} days from the date issued. {data?.threshold ?? 3} or more in force = subject to suspension.</p>
      </div>
      <Button type="button" variant={showForm ? "outline" : "default"} onClick={() => { setShowForm((value) => !value); setMessage(""); }}>{showForm ? <><X className="mr-2 size-4" />Close form</> : <><Plus className="mr-2 size-4" />Issue NTE</>}</Button>
    </div>

    {showForm && <form className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      if (await send("POST", { ...values, employeeId })) { form.reset(); setEmployeeId(""); setShowForm(false); setView("active"); setPage(1); }
    }}>
      <label className="text-sm">Employee *<SearchSelect aria-label="Employee" className="mt-1 h-9" placeholder="Search employee" value={employeeId} onValueChange={setEmployeeId} options={employees.map((item) => ({ value: item.id, label: item.name, description: item.id }))} /></label>
      <label className="text-sm">Date issued *<input name="issuedOn" type="date" required className={fieldClass} defaultValue={data?.today} max={data?.today} /></label>
      <label className="text-sm sm:col-span-2">Reason *<input name="reason" required minLength={3} maxLength={200} className={fieldClass} placeholder="e.g. Late remittance on Oct 5, 2026" /></label>
      <label className="text-sm sm:col-span-2 lg:col-span-4">Details<textarea name="details" maxLength={2000} rows={2} className={fieldClass} placeholder="Optional" /></label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={busy || !employeeId}>{busy ? "Saving..." : "Issue NTE"}</Button>
        <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
      </div>
    </form>}
    {message && <p role="status" className="text-sm">{message}</p>}

    {flagged.length > 0 && <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertTriangle className="size-4 shrink-0" /><span className="font-semibold">Subject to suspension:</span>
      {flagged.map((item, index) => <span key={item.employeeId} title={`The earliest expires ${showDate(item.nextExpiry)}`}>{item.employeeName} ({item.active}, earliest expires {showDate(item.nextExpiry)}){index < flagged.length - 1 ? ";" : ""}</span>)}
    </div>}

    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
        {views.map((item) => <Button key={item.key} type="button" size="sm" variant={view === item.key ? "default" : "outline"} aria-pressed={view === item.key} onClick={() => { setView(item.key); setPage(1); setOpenId(""); }}>
          {item.label} <span className={`ml-1 font-semibold ${view === item.key ? "" : item.count ? item.tone ?? "" : "text-muted-foreground"}`}>{item.count}</span>
        </Button>)}
      </div>
      <input aria-label="Search notices" className="ml-auto h-9 w-full rounded-md border bg-background px-2 text-sm sm:w-64" placeholder="Search employee or reason" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
    </div>

    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr>{["Employee", "Reason", "In force", "Status", "Employee's reply", ""].map((label, index) => <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>
          {shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((nte) => {
            const open = openId === nte.id;
            return <Fragment key={nte.id}>
              <tr className={`border-t ${open ? "bg-muted/30" : "hover:bg-muted/20"}`}>
                <td className="p-2"><button type="button" className="text-left font-medium hover:underline" onClick={() => setOpenId(open ? "" : nte.id)}>{nte.employeeName}</button><span className="block text-xs text-muted-foreground">{inForce(nte.employeeId)} in force</span></td>
                <td className="max-w-sm p-2"><span className="line-clamp-1" title={nte.reason}>{nte.reason}</span></td>
                <td className="whitespace-nowrap p-2 text-xs">{showDate(nte.issuedOn)}<span className="block text-muted-foreground">to {showDate(nte.expiresOn)}</span></td>
                <td className="p-2"><StatusBadge status={nte.status} tone={nte.status === "Active" ? "warning" : undefined} /></td>
                <td className="p-2 text-xs">{nte.explanation
                  ? nte.reviewedAt ? <span className="text-emerald-700">Explained · reviewed</span> : <span className="font-medium text-amber-700">Explained · needs review</span>
                  : nte.acknowledgedAt ? <span className="text-muted-foreground">Read; no explanation yet</span>
                  : nte.status === "Active" ? <span className="text-amber-700">Not yet read</span> : <span className="text-muted-foreground">-</span>}</td>
                <td className="whitespace-nowrap p-2 text-right">
                  {needsReview(nte) && !open && <Button type="button" size="sm" variant="outline" className="mr-1" onClick={() => setOpenId(nte.id)}>Read reply</Button>}
                  <Button type="button" size="sm" variant="ghost" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpenId(open ? "" : nte.id)}>{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>
                </td>
              </tr>
              {open && <tr className="border-t bg-muted/10"><td colSpan={6} className="p-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Notice</p>
                    <p className="font-medium">{nte.reason}</p>
                    {nte.details && <p className="whitespace-pre-wrap">{nte.details}</p>}
                    <p className="text-xs text-muted-foreground">{nte.employeeId} · issued {showDate(nte.issuedOn)}{nte.issuedBy ? ` by ${nte.issuedBy}` : ""} · in force until {showDate(nte.expiresOn)}</p>
                    {nte.withdrawnReason && <p className="text-xs text-muted-foreground">Withdrawn: {nte.withdrawnReason}</p>}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Employee&apos;s reply</p>
                    {nte.explanation
                      ? <><p className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-2">{nte.explanation}</p>
                        <p className="text-xs text-muted-foreground">Explained {when(nte.explainedAt)}{nte.reviewedAt && <span className="text-emerald-700"> · reviewed {when(nte.reviewedAt)}{nte.reviewedBy ? ` by ${nte.reviewedBy}` : ""}</span>}</p></>
                      : <p className="text-sm text-muted-foreground">{nte.acknowledgedAt ? `Read ${when(nte.acknowledgedAt)}; no explanation yet.` : "Not yet read by the employee."}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {needsReview(nte) && <Button type="button" size="sm" disabled={busy} onClick={() => void send("PATCH", { id: nte.id, action: "reviewed" })}>Mark reviewed</Button>}
                  {nte.status === "Active" && <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={async () => { const reason = await promptDialog(`Withdraw the notice to ${nte.employeeName}? Give the reason:`, { required: true }); if (reason) void send("PATCH", { id: nte.id, reason }); }}>Withdraw</Button>}
                </div>
              </td></tr>}
            </Fragment>;
          })}
          {!shown.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{data ? "No notices here." : "Loading..."}</td></tr>}
        </tbody>
      </table>
    </div>
    {pages > 1 && <div className="flex items-center justify-end gap-3">
      <Button type="button" size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
      <span className="text-sm">Page {currentPage} of {pages}</span>
      <Button type="button" size="sm" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button>
    </div>}
  </section>;
}
