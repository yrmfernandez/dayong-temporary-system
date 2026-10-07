"use client";

import { AlertTriangle, Eye, Printer, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { EntryDetails } from "@/components/entry-details";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClerkReport as Report, ReportLine } from "@/lib/clerk-report";
import { EXPENSE_ACCOUNTS, EXPENSE_APPROVERS } from "@/lib/expense-options";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Kind = "daily" | "weekly" | "monthly" | "yearly";
type Remark = { id: string; comment: string; createdAt: string; encodedBy: string };
type Result = { success: boolean; message?: string; report: Report; remarks: Remark[]; canChoose: boolean; isOwn: boolean; clerks: Array<{ employeeId: string; name: string; branch: string }> };

const money = (value: number) => (value ? new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : "-");
const todayInManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
// The period input's value and the date sent to the server (any day inside the period).
const inputType = (kind: Kind) => (kind === "monthly" ? "month" : kind === "yearly" ? "number" : "date");
const toInput = (kind: Kind, date: string) => (kind === "monthly" ? date.slice(0, 7) : kind === "yearly" ? date.slice(0, 4) : date);
const fromInput = (kind: Kind, value: string) => (kind === "monthly" ? `${value}-01` : kind === "yearly" ? `${value}-01-01` : value);
const field = "h-8 w-full rounded-md border bg-background px-2 text-sm";
// Section colours from the company's report.
const tone = {
  sales: "bg-purple-700 text-white", collections: "bg-blue-950 text-white", expenses: "bg-lime-500 text-lime-950", cashFlow: "bg-amber-400 text-amber-950",
  total: "bg-orange-200 text-orange-950", cashBeg: "bg-blue-600 text-white", cashIn: "bg-lime-400 text-lime-950", cashOut: "bg-red-700 text-white", remaining: "bg-sky-400 text-sky-950",
};

/**
 * An Entry Clerk's report in the company's layout. A clerk sees their own and records expenses, bank deposits and notes
 * on it; with `review` (Report Review and Audits) the reviewer chooses the clerk and gets the entry checklist and remarks.
 */
export function ClerkReport({ kind, review = false, employeeId: fixedEmployee, date: fixedDate }: { kind: Kind; review?: boolean; employeeId?: string; date?: string }) {
  const [date, setDate] = useState(fixedDate ?? todayInManila());
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showEntries, setShowEntries] = useState(review);
  const [open, setOpen] = useState("");
  const [remark, setRemark] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, date, ...(employeeId ? { employeeId } : {}) });
      const response = await fetch(`/api/clerk-report?${params}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to build the report.");
      setData(result);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to build the report.");
    } finally {
      setLoading(false);
    }
  }, [kind, date, employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the period or clerk changes
    void load();
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["sales", "collections", "remittances", "remittance_collections", "expenses", "cash_transactions", "bank_deposits", "daily_audits", "report_remarks", "report_notes"], load, 3000);

  /** Sends one of the clerk's own report actions, then reloads the report. */
  const act = async (body: Record<string, unknown>) => {
    setMessage("");
    const response = await fetch("/api/clerk-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, date, ...body }) });
    const result = await response.json();
    setMessage(result.message || (response.ok ? "Saved." : "Unable to save."));
    if (response.ok && result.success) await load();
    return response.ok && result.success;
  };

  const saveRemark = async () => {
    if (!data || !remark.trim()) return;
    const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: data.report.from, to: data.report.to, reportType: kind, scope: data.report.encoder.name, comment: remark }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message || "Unable to save the remark."); return; }
    setRemark("");
    await load();
  };

  const report = data?.report;
  const own = Boolean(data?.isOwn && !review);
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

      {message && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">{message}</p>}

      {report && (
        <div className="clerk-report-sheet overflow-x-auto rounded-xl border bg-card p-3 text-[13px] text-card-foreground print:border-0 print:p-0">
          <div className="min-w-[980px] space-y-3">
            <ReportHeader report={report} />

            <div className="grid grid-cols-2 gap-3">
              <EntryTable title="New Sales Section" color={tone.sales} groupLabel={report.groupLabel} rows={report.newSales.rows} total={report.newSales.total} />
              <EntryTable title="Collections Section" color={tone.collections} groupLabel={report.groupLabel} rows={report.collection.rows} total={report.collection.total} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Grid title="Expenses/Other Cash Out Section" color={tone.expenses}
                headers={["Account Name/Type of Expense", report.whenLabel, "Amount", "Receipt/CV", "Purpose", "Rmks"]}
                rows={report.expenses.map((item) => [item.account, item.when, money(item.amount), item.receipt, item.purpose, item.remarks])}
                total={report.expenseTotal} />
              <Grid title="Cash Flow Transaction and Other Cash Ins" color={tone.cashFlow}
                headers={["Bank Account Name", report.whenLabel, "Amount", "Type of Transfer", "MAS", "Rmks"]}
                rows={report.deposits.map((item) => [item.bankAccount, item.when, money(item.amount), item.transferType, item.mas, item.remarks])}
                total={report.depositTotal}
                action={own ? (index) => <button type="button" className="text-xs text-red-700 underline print:hidden" onClick={() => { const reason = window.prompt("Why is this deposit being voided?"); if (reason) void act({ action: "void-deposit", id: report.deposits[index].id, reason }); }}>Void</button> : undefined} />
            </div>

            <div className="grid grid-cols-[1.1fr_0.8fr_1.6fr] gap-3">
              <dl className="space-y-0.5">
                <Cash label="Cash Beg/Pending COH" value={report.cash.cashBeg} color={tone.cashBeg} />
                <Cash label="Sales Net" value={report.cash.salesNet} />
                <Cash label="Collection Net" value={report.cash.collectionNet} />
                <Cash label="Fidelity Bond" value={report.cash.fidelity} />
                <Cash label="Pending cash, to be encoded" value={report.cash.pendingCash} />
                <Cash label="Total Cash In" value={report.cash.totalCashIn} color={tone.cashIn} strong />
                <div className="h-2" />
                <Cash label="Expenses" value={report.cash.expenses} />
                <Cash label="Cash forwarded to bank" value={report.cash.forwardedToBank} />
                <Cash label="Total Cash Out/Expense" value={report.cash.totalCashOut} color={tone.cashOut} strong />
                <div className="h-2" />
                <Cash label="Remaining Cash on Hand" value={report.cash.remainingCashOnHand} color={tone.remaining} strong />
                <div className="flex justify-end gap-6 pt-3 font-bold italic"><span>TOTALS</span><span className="w-28 text-right">{money(report.cash.totals)}</span></div>
              </dl>
              <NoteBox title="Specific Rmks" text={report.notes.specificRemarks} />
              <div className="space-y-3">
                <NoteBox title="Pending Transactions:" text={report.notes.pendingTransactions} />
                <NoteBox title="Other Comments/Rmks" text={report.notes.otherComments} />
              </div>
            </div>
          </div>
        </div>
      )}

      {report && kind !== "daily" && <MasSummary report={report} />}

      {report && own && <RecordPanel report={report} act={act} />}

      {report && (
        <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3 print:hidden">
          <p className="font-semibold sm:col-span-3">Checks</p>
          <Check label="Remitted (company share)" value={money(report.checks.remitted)} />
          <Check label="Not yet remitted" value={money(report.checks.notYetRemitted)} />
          <Check label="Penalties (separate from remittance)" value={money(report.checks.penalties)} />
          <Check label="Forfeited incentives" value={money(report.checks.forfeitedIncentives)} />
          <Check label="Receipt photos attached" value={`${report.checks.withPhoto} of ${report.checks.entryCount}`} />
          <Check label="Entries with dates to check" value={String(report.checks.withDateWarnings)} />
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
          <p className="font-semibold">Reviewer remarks on this report</p>
          {data.remarks.map((item) => <p key={item.id} className="text-sm"><span className="text-muted-foreground">{item.createdAt.slice(0, 16).replace("T", " ")} · {item.encodedBy}:</span> {item.comment}</p>)}
          {!data.remarks.length && <p className="text-sm text-muted-foreground">No remarks yet.</p>}
          <div className="flex gap-2"><Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Add a remark for this clerk's report" /><Button type="button" disabled={!remark.trim()} onClick={() => void saveRemark()}>Save</Button></div>
        </div>
      )}
    </div>
  );
}

function ReportHeader({ report }: { report: Report }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_1.1fr] items-center gap-3 border-b pb-2">
      <div className="leading-tight">
        <p className="font-bold">{report.company.name}</p>
        <p className="text-xs">{report.company.address}</p>
        <p className="text-xs">SEC Reg No.: {report.company.secRegNo}</p>
      </div>
      <BrandLogo className="size-14 object-contain" />
      <div className="bg-neutral-900 px-5 py-3 text-lg font-bold text-white">{report.reportName}</div>
      <dl className="grid grid-cols-[auto_1fr_auto] gap-x-2 text-xs">
        <dt className="text-right">Branch:</dt><dd className="col-span-2 border-b font-semibold">{report.branch || "—"}</dd>
        <dt className="text-right">Entry Clerk:</dt><dd className="col-span-2 border-b font-semibold uppercase">{report.encoder.name}</dd>
        <dt className="text-right">Date + Week:</dt><dd className="border-b font-semibold">{report.dateLine}</dd><dd className="border-b font-semibold">{report.weekLine}</dd>
      </dl>
    </div>
  );
}

function EntryTable({ title, color, groupLabel, rows, total }: { title: string; color: string; groupLabel: string; rows: ReportLine[]; total: ReportLine }) {
  const cells = (line: ReportLine) => [String(line.accounts || "-"), money(line.gross), money(line.incentives), money(line.net), money(line.fidelity)];
  const filler = Math.max(0, 5 - rows.length);
  return (
    <table className="w-full border-collapse border text-[12px]">
      <thead>
        <tr><th colSpan={6} className={`p-1 text-center font-bold ${color}`}>{title}</th></tr>
        <tr className="border-b">{[groupLabel, "Accts", "Gross", "Inc", "Net", "Fid/ bond"].map((header, index) => <th key={header} className={`border-r p-1 font-semibold ${index ? "text-right" : "text-left"} ${index === 5 ? "text-[10px] italic" : ""}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((line) => <tr key={line.label} className="border-b"><td className="border-r p-1 font-medium">{line.label}</td>{cells(line).map((value, index) => <td key={index} className="border-r p-1 text-right tabular-nums">{value}</td>)}</tr>)}
        {Array.from({ length: filler }, (_, index) => <tr key={`filler-${index}`} className="h-6 border-b">{Array.from({ length: 6 }, (__, cell) => <td key={cell} className="border-r" />)}</tr>)}
        <tr className={`font-bold ${color}`}><td className="p-1.5 text-center">Total</td>{cells(total).map((value, index) => <td key={index} className="p-1.5 text-right tabular-nums">{value}</td>)}</tr>
      </tbody>
    </table>
  );
}

function Grid({ title, color, headers, rows, total, action }: { title: string; color: string; headers: string[]; rows: string[][]; total: number; action?: (index: number) => React.ReactNode }) {
  const filler = Math.max(0, 4 - rows.length);
  return (
    <table className="w-full border-collapse border text-[12px]">
      <thead>
        <tr><th colSpan={6} className={`p-1 text-center font-bold ${color}`}>{title}</th></tr>
        <tr className="border-b">{headers.map((header, index) => <th key={header} className={`border-r p-1 font-semibold ${index === 0 || index === 3 ? "text-[10px]" : ""}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b">{row.map((value, index) => <td key={index} className={`border-r p-1 ${index === 2 ? "text-right tabular-nums" : "text-center"}`}>{value}{index === 5 && action?.(rowIndex)}</td>)}</tr>)}
        {Array.from({ length: filler }, (_, index) => <tr key={`filler-${index}`} className="h-6 border-b">{Array.from({ length: 6 }, (__, cell) => <td key={cell} className="border-r" />)}</tr>)}
        <tr className="font-bold"><td className={`p-1.5 text-center ${tone.total}`}>Total</td><td className="bg-neutral-900" /><td className="p-1.5 text-right tabular-nums">{money(total)}</td><td colSpan={3} className="bg-neutral-900" /></tr>
      </tbody>
    </table>
  );
}

function Cash({ label, value, color, strong }: { label: string; value: number; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`w-28 px-1 text-right tabular-nums ${color ?? ""} ${strong ? "font-bold" : ""}`}>{money(value)}</dd>
    </div>
  );
}

function NoteBox({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-h-28 border p-2">
      <p className="text-xs italic">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-xs font-semibold">{text}</p>
    </div>
  );
}

function Check({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 rounded border px-2 py-1"><span className="text-muted-foreground">{label}</span><span className="font-semibold tabular-nums">{value}</span></div>;
}

/** The summary sheet: New Member and Collection by Marketing Account Staff for the period. */
function MasSummary({ report }: { report: Report }) {
  const line = (sales: ReportLine, collections: ReportLine) => [String(sales.accounts || ""), money(sales.gross), money(sales.incentives), String(collections.accounts || ""), money(collections.gross), money(collections.incentives)];
  return (
    <div className="clerk-report-sheet overflow-x-auto rounded-xl border bg-card p-3 text-[13px] text-card-foreground print:break-before-page print:border-0">
      <div className="min-w-[760px] space-y-2">
        <div className="bg-yellow-300 py-1 text-center font-bold leading-tight text-neutral-900">
          <p>{report.company.name}</p><p>{report.masSummary.title}</p><p>NEW MEMBER AND COLLECTION</p>
        </div>
        <div className="flex justify-between gap-6 text-xs">
          <p className="font-bold">{report.summaryLabel}</p>
          <dl className="grid grid-cols-[auto_12rem] gap-x-2">
            <dt className="text-right">Week and Date:</dt><dd className="border-b font-semibold">{report.summaryWeek}</dd>
            <dt className="text-right">Branch Name:</dt><dd className="border-b font-semibold">{report.branch || "—"}</dd>
            <dt className="text-right">Encoder&apos;s Name:</dt><dd className="border-b font-semibold uppercase">{report.encoder.name}</dd>
          </dl>
        </div>
        <table className="w-full border-collapse border text-[12px]">
          <thead>
            <tr><th rowSpan={2} className="border p-1">No.</th><th rowSpan={2} className="border p-1">Marketing Account Staff</th><th colSpan={3} className="border bg-orange-200 p-1 text-orange-950">NEW SALES</th><th colSpan={3} className="border bg-blue-200 p-1 text-blue-950">COLLECTION</th><th colSpan={3} className="border bg-green-200 p-1 text-green-950">CVE (%)</th></tr>
            <tr>{["ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "CVE%"].map((header, index) => <th key={`${header}-${index}`} className="border p-1 text-[11px]">{header}</th>)}</tr>
          </thead>
          <tbody>
            {report.masSummary.rows.map((row, index) => (
              <tr key={row.name}><td className="border p-1 text-center">{index + 1}</td><td className="border p-1 font-semibold">{row.name}</td>{line(row.sales, row.collections).map((value, cell) => <td key={cell} className="border p-1 text-right tabular-nums">{value}</td>)}<td className="border p-1 text-center text-muted-foreground" colSpan={3}>—</td></tr>
            ))}
            {!report.masSummary.rows.length && <tr><td colSpan={11} className="border p-3 text-center text-muted-foreground">Nothing encoded in this period.</td></tr>}
            <tr className="bg-blue-950 font-bold text-white"><td colSpan={2} className="p-1.5 text-center">Total</td>{line(report.masSummary.total.sales, report.masSummary.total.collections).map((value, cell) => <td key={cell} className="p-1.5 text-right tabular-nums">{value}</td>)}<td colSpan={3} className="p-1.5 text-center">—</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The clerk records what the report needs besides New Sales and Collections. */
function RecordPanel({ report, act }: { report: Report; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const today = todayInManila();
  const inPeriod = today >= report.from && today <= report.to ? today : report.to;
  const [expense, setExpense] = useState({ category: "Transportation", categoryOther: "", date: inPeriod, amount: "", receiptNumber: "", description: "", remarks: "", approvedBy: "VP Finance", approvedByOther: "" });
  const [deposit, setDeposit] = useState({ date: inPeriod, bankAccount: "DSRDPI", amount: "", transferType: "", mas: "", remarks: "" });
  const [notes, setNotes] = useState({ pendingCash: String(report.notes.pendingCash || ""), specificRemarks: report.notes.specificRemarks, pendingTransactions: report.notes.pendingTransactions, otherComments: report.notes.otherComments });
  const masNames = report.masSummary.rows.map((row) => row.name);

  return (
    <div className="grid gap-4 rounded-xl border p-4 print:hidden lg:grid-cols-3">
      <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "add-expense", ...expense, amount: Number(expense.amount), attachments: [] })) setExpense((current) => ({ ...current, amount: "", receiptNumber: "", description: "", remarks: "" })); }}>
        <p className="font-semibold">Add expense / other cash out</p>
        <Label className="text-xs">Account name / type of expense<select className={field} value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>{EXPENSE_ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select></Label>
        {expense.category === "Other" && <Input placeholder="Specify the expense" value={expense.categoryOther} onChange={(event) => setExpense({ ...expense, categoryOther: event.target.value })} />}
        <div className="grid grid-cols-2 gap-2">
          <Label className="text-xs">Date<Input type="date" value={expense.date} onChange={(event) => setExpense({ ...expense, date: event.target.value })} /></Label>
          <Label className="text-xs">Amount<Input type="number" min="0" step="0.01" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} /></Label>
        </div>
        <Label className="text-xs">Receipt / CV no.<Input value={expense.receiptNumber} onChange={(event) => setExpense({ ...expense, receiptNumber: event.target.value })} /></Label>
        <Label className="text-xs">Purpose<Input value={expense.description} onChange={(event) => setExpense({ ...expense, description: event.target.value })} /></Label>
        <Label className="text-xs">Remarks<Input value={expense.remarks} onChange={(event) => setExpense({ ...expense, remarks: event.target.value })} /></Label>
        <Label className="text-xs">Approved by<select className={field} value={expense.approvedBy} onChange={(event) => setExpense({ ...expense, approvedBy: event.target.value })}>{EXPENSE_APPROVERS.map((item) => <option key={item}>{item}</option>)}</select></Label>
        {expense.approvedBy === "Other" && <Input placeholder="Who approved it" value={expense.approvedByOther} onChange={(event) => setExpense({ ...expense, approvedByOther: event.target.value })} />}
        <Button type="submit" size="sm" disabled={!expense.amount || !expense.description.trim()}>Save expense</Button>
        <p className="text-xs text-muted-foreground">Saved to Expenses for your branch; Finance can void a wrong one.</p>
      </form>

      <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "add-deposit", ...deposit, amount: Number(deposit.amount) })) setDeposit((current) => ({ ...current, amount: "", remarks: "" })); }}>
        <p className="font-semibold">Add cash forwarded to bank</p>
        <div className="grid grid-cols-2 gap-2">
          <Label className="text-xs">Date<Input type="date" value={deposit.date} onChange={(event) => setDeposit({ ...deposit, date: event.target.value })} /></Label>
          <Label className="text-xs">Amount<Input type="number" min="0" step="0.01" value={deposit.amount} onChange={(event) => setDeposit({ ...deposit, amount: event.target.value })} /></Label>
        </div>
        <Label className="text-xs">Bank account name<Input value={deposit.bankAccount} onChange={(event) => setDeposit({ ...deposit, bankAccount: event.target.value })} /></Label>
        <Label className="text-xs">Type of transfer<Input value={deposit.transferType} onChange={(event) => setDeposit({ ...deposit, transferType: event.target.value })} placeholder="e.g. RCBC, GCash" /></Label>
        <Label className="text-xs">MAS<Input list="report-mas" value={deposit.mas} onChange={(event) => setDeposit({ ...deposit, mas: event.target.value })} /><datalist id="report-mas">{masNames.map((name) => <option key={name} value={name} />)}</datalist></Label>
        <Label className="text-xs">Remarks<Input value={deposit.remarks} onChange={(event) => setDeposit({ ...deposit, remarks: event.target.value })} placeholder="e.g. Already deposited" /></Label>
        <Button type="submit" size="sm" disabled={!deposit.amount || !deposit.transferType.trim()}>Save deposit</Button>
      </form>

      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void act({ action: "save-notes", ...notes, pendingCash: Number(notes.pendingCash) || 0 }); }}>
        <p className="font-semibold">Notes for this report</p>
        <Label className="text-xs">Pending cash, to be encoded<Input type="number" min="0" step="0.01" value={notes.pendingCash} onChange={(event) => setNotes({ ...notes, pendingCash: event.target.value })} /></Label>
        <Label className="text-xs">Specific remarks<textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={notes.specificRemarks} onChange={(event) => setNotes({ ...notes, specificRemarks: event.target.value })} /></Label>
        <Label className="text-xs">Pending transactions<textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={notes.pendingTransactions} onChange={(event) => setNotes({ ...notes, pendingTransactions: event.target.value })} /></Label>
        <Label className="text-xs">Other comments / remarks<textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" value={notes.otherComments} onChange={(event) => setNotes({ ...notes, otherComments: event.target.value })} /></Label>
        <Button type="submit" size="sm">Save notes</Button>
        {report.notes.updatedAt && <p className="text-xs text-muted-foreground">Last saved {new Date(report.notes.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {report.notes.updatedBy}</p>}
      </form>
    </div>
  );
}
