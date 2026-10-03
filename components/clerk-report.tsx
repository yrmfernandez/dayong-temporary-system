"use client";

import { AlertTriangle, Eye, Printer, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { EntryDetails } from "@/components/entry-details";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClerkReport as Report, ReportLine } from "@/lib/clerk-report";

type Kind = "daily" | "weekly" | "monthly" | "yearly";
type Remark = { id: string; comment: string; createdAt: string; encodedBy: string };
type Result = { success: boolean; message?: string; report: Report; remarks: Remark[]; canChoose: boolean; clerks: Array<{ employeeId: string; name: string; branch: string }> };

const money = (value: number) => new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const todayInManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
// The period input's value and the date sent to the server (any day inside the period).
const inputType = (kind: Kind) => (kind === "monthly" ? "month" : kind === "yearly" ? "number" : "date");
const toInput = (kind: Kind, date: string) => (kind === "monthly" ? date.slice(0, 7) : kind === "yearly" ? date.slice(0, 4) : date);
const fromInput = (kind: Kind, value: string) => (kind === "monthly" ? `${value}-01` : kind === "yearly" ? `${value}-01-01` : value);

/**
 * An Entry Clerk's report in the company's paper layout. A clerk sees their own; with `review` (Report Review and
 * Audits) the reviewer chooses the clerk and also gets the entry-by-entry checklist and remarks.
 */
export function ClerkReport({ kind, review = false, employeeId: fixedEmployee, date: fixedDate }: { kind: Kind; review?: boolean; employeeId?: string; date?: string }) {
  const [date, setDate] = useState(fixedDate ?? todayInManila());
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEntries, setShowEntries] = useState(review);
  const [open, setOpen] = useState("");
  const [remark, setRemark] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ kind, date, ...(employeeId ? { employeeId } : {}) });
      const response = await fetch(`/api/clerk-report?${params}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to build the report.");
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to build the report.");
    } finally {
      setLoading(false);
    }
  }, [kind, date, employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the period or clerk changes
    void load();
  }, [load]);

  const saveRemark = async () => {
    if (!data || !remark.trim()) return;
    const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: data.report.from, to: data.report.to, reportType: kind, scope: data.report.encoder.name, comment: remark }) });
    const result = await response.json();
    if (!response.ok) { setError(result.message || "Unable to save the remark."); return; }
    setRemark("");
    await load();
  };

  const report = data?.report;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">Period
          <Input className="mt-1 w-44" type={inputType(kind)} min={kind === "yearly" ? 2000 : undefined} max={kind === "yearly" ? 2100 : undefined} value={toInput(kind, date)} disabled={Boolean(fixedDate)} onChange={(event) => event.target.value && setDate(fromInput(kind, event.target.value))} />
        </label>
        {data?.canChoose && !fixedEmployee && (
          <label className="text-sm">Entry Clerk
            <select className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm" value={employeeId || report?.encoder.employeeId || ""} onChange={(event) => setEmployeeId(event.target.value)}>
              {data.clerks.map((clerk) => <option key={clerk.employeeId} value={clerk.employeeId}>{clerk.name}{clerk.branch ? ` · ${clerk.branch}` : ""}</option>)}
            </select>
          </label>
        )}
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        <Button type="button" variant="outline" disabled={!report} onClick={() => window.print()}><Printer className="size-4" />Print</Button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showEntries} onChange={(event) => setShowEntries(event.target.checked)} />Show every entry</label>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {report && (
        <div className="overflow-x-auto rounded-xl border bg-background p-4 text-sm sm:p-6 print:border-0 print:p-0">
          <div className="mx-auto min-w-[640px] max-w-4xl space-y-5">
            <header className="space-y-0.5 text-center">
              <p className="text-base font-bold">{report.company}</p>
              <p className="font-semibold">{report.title}</p>
              <p className="font-semibold">{report.subtitle}</p>
            </header>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium capitalize">{kind} report</dt><dd />
              <dt className="text-muted-foreground">Week and Date</dt><dd className="font-semibold">{report.weekAndDate}</dd>
              <dt className="text-muted-foreground">Branch Name</dt><dd className="font-semibold">{report.branch || "—"}</dd>
              <dt className="text-muted-foreground">Encoder&apos;s Name</dt><dd className="font-semibold">{report.encoder.name}</dd>
            </dl>

            <Section title="NEW SALES" tone="bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100" groupLabel={report.groupLabel} rows={report.newSales.rows} total={report.newSales.total} />
            <Section title="COLLECTION" tone="bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100" groupLabel={report.groupLabel} rows={report.collection.rows} total={report.collection.total} />

            <div className="grid gap-6 sm:grid-cols-2">
              <dl className="space-y-1">
                <Line label="Total Accounts" value={String(report.summary.accounts)} />
                <Line label="Total Gross" value={money(report.summary.gross)} />
                <Line label="Total Incentives" value={money(report.summary.incentives)} />
                <Line label="Net (Gross - Incentives)" value={money(report.summary.net)} />
                <Line label="Total Fid. Bond" value={money(report.summary.fidelity)} />
                <Line label="Total Net Remittance" value={money(report.summary.netRemittance)} strong />
              </dl>
              <dl className="space-y-1">
                <Line label="Expenses" value={money(report.summary.expenses)} />
                {report.expenses.map((expense) => <Line key={expense.id} label={`  ${expense.date} · ${expense.category || expense.description}`} value={money(expense.amount)} muted />)}
                <Line label="TOTAL CASH" value={money(report.summary.totalCash)} strong highlight />
              </dl>
            </div>

            <div className="rounded-lg border p-3">
              <p className="mb-2 font-semibold">Checks</p>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Line label="Remitted (company share)" value={money(report.checks.remitted)} />
                <Line label="Not yet remitted" value={money(report.checks.notYetRemitted)} />
                <Line label="Penalties (separate from remittance)" value={money(report.checks.penalties)} />
                <Line label="Forfeited incentives" value={money(report.checks.forfeitedIncentives)} />
                <Line label="Receipt photos attached" value={`${report.checks.withPhoto} of ${report.checks.entryCount}`} />
                <Line label="Entries with dates to check" value={String(report.checks.withDateWarnings)} />
              </dl>
            </div>

            <div className="pt-4"><p className="text-muted-foreground">Prepared by:</p><p className="font-semibold uppercase">{report.preparedBy}</p></div>
          </div>
        </div>
      )}

      {report && showEntries && (
        <div className="space-y-2 print:break-before-page">
          <p className="font-semibold">Every entry ({report.checks.entryCount}){report.entriesTruncated ? ", first 1,000 shown" : ""}</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-2">Encoded</th><th className="p-2">Entry</th><th className="p-2">OR / App · date</th><th className="p-2">Date remitted</th><th className="p-2">Member</th><th className="p-2">MAS / Collector</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Incentive</th><th className="p-2">Status</th><th className="p-2">Receipt</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="border-t align-top">
                      <td className="p-2 text-xs">{entry.encodedAt}</td>
                      <td className="p-2"><span className="block text-xs font-semibold">{entry.kind}</span><span className="font-mono text-xs">{entry.id}</span>{entry.warnings.length > 0 && <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="size-3" />{entry.warnings.length} date warning{entry.warnings.length === 1 ? "" : "s"}</span>}</td>
                      <td className="p-2">{entry.orNumber || (entry.applicationNumber ? `App ${entry.applicationNumber}` : "—")}<span className="block text-xs text-muted-foreground">{entry.orDate}</span></td>
                      <td className="p-2">{entry.dateRemitted || "—"}</td>
                      <td className="p-2">{entry.memberName || "—"}<span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                      <td className="p-2">{entry.person}</td>
                      <td className="p-2 text-right">{money(entry.amount)}</td>
                      <td className="p-2 text-right">{money(entry.incentive)}</td>
                      <td className="p-2"><StatusBadge status={entry.remittanceStatus || "Not set"} /></td>
                      <td className="p-2">{entry.photoId ? <ReceiptPhotoView photoId={entry.photoId} label="View" /> : <StatusBadge status="Missing" tone="warning" />}</td>
                      <td className="p-2 print:hidden"><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === entry.id ? "" : entry.id)}><Eye className="size-3.5" />Details</Button></td>
                    </tr>
                    {open === entry.id && <tr className="border-t bg-muted/20"><td colSpan={11} className="p-3"><EntryDetails entry={entry} onClose={() => setOpen("")} /></td></tr>}
                  </Fragment>
                ))}
                {!report.entries.length && <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">Nothing encoded in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && review && (
        <div className="space-y-2 rounded-lg border p-3 print:hidden">
          <p className="font-semibold">Remarks on this report</p>
          {data.remarks.map((item) => <p key={item.id} className="text-sm"><span className="text-muted-foreground">{item.createdAt.slice(0, 16).replace("T", " ")} · {item.encodedBy}:</span> {item.comment}</p>)}
          {!data.remarks.length && <p className="text-sm text-muted-foreground">No remarks yet.</p>}
          <div className="flex gap-2"><Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Add a remark for this clerk's report" /><Button type="button" disabled={!remark.trim()} onClick={() => void saveRemark()}>Save</Button></div>
        </div>
      )}
    </div>
  );
}

function Section({ title, tone, groupLabel, rows, total }: { title: string; tone: string; groupLabel: string; rows: ReportLine[]; total: ReportLine }) {
  const cells = (line: ReportLine) => [String(line.accounts), money(line.gross), money(line.incentives), money(line.net), money(line.fidelity)];
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr><th colSpan={6} className={`p-1.5 text-center font-bold ${tone}`}>{title}</th></tr>
        <tr className="border-b bg-muted/40">{[groupLabel, "Accounts", "Gross", "Incentives", "Net", "Fidelity Bond"].map((header, index) => <th key={header} className={`p-1.5 ${index ? "text-right" : "text-left"}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((line) => <tr key={line.label} className="border-b"><td className="p-1.5">{line.label}</td>{cells(line).map((value, index) => <td key={index} className="p-1.5 text-right tabular-nums">{value}</td>)}</tr>)}
        <tr className="bg-orange-300 font-bold text-orange-950 dark:bg-orange-800 dark:text-orange-50"><td className="p-1.5">TOTAL:</td>{cells(total).map((value, index) => <td key={index} className="p-1.5 text-right tabular-nums">{value}</td>)}</tr>
      </tbody>
    </table>
  );
}

function Line({ label, value, strong, muted, highlight }: { label: string; value: string; strong?: boolean; muted?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${highlight ? "rounded bg-yellow-200 px-1 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-50" : ""}`}>
      <dt className={`${strong ? "font-bold" : ""} ${muted ? "pl-3 text-xs text-muted-foreground" : ""}`}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : ""} ${muted ? "text-xs text-muted-foreground" : ""}`}>{value}</dd>
    </div>
  );
}
