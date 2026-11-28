"use client";

import { promptDialog } from "@/components/app-dialog";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Eye, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { EntryDetails } from "@/components/entry-details";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { ReceiptPhotosPicker, type PickedPhoto } from "@/components/receipt-photos-picker";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readApiResponse } from "@/lib/api-response";
import type { ClerkReport as Report, ReportLine } from "@/lib/clerk-report";
import type { ClerkAuditView } from "@/lib/daily-audit";
import type { CashCount } from "@/lib/cash-position";
import { CARRY_START } from "@/lib/cash-carry";
import type { ClerkPeriod, PeriodView } from "@/lib/report-periods";
import { BURIAL_ACCOUNT, EXPENSE_ACCOUNTS, EXPENSE_APPROVERS } from "@/lib/expense-options";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate as showDate, formatDateTime as showDateTime } from "@/lib/date-format";
import { manilaToday } from "@/lib/manila-date";
import { canRemitWholeAmount, FINANCE_TURNOVER, isFinanceTurnover, remittedOver } from "@/lib/cash-turnover";

type Kind = "daily" | "weekly" | "monthly" | "yearly";
type Remark = { id: string; comment: string; createdAt: string; encodedBy: string };
type Result = { success: boolean; message?: string; report: Report; cashCounts?: CashCount[]; period: PeriodView | null; remarks: Remark[]; canChoose: boolean; isOwn: boolean; audit: ClerkAuditView; branch: string; branchChoices: string[]; masChoices: Array<{ id: string; name: string }>; clerks: Array<{ employeeId: string; name: string; branch: string }> };

const money = (value: number) => (value ? new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : "-");
// Moving a day, a week, a month or a year back or forward (Previous / Next, owner, November 26, 2026).
const shiftDays = (date: string, days: number) => { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + days); return day.toISOString().slice(0, 10); };
const shiftMonths = (date: string, months: number) => { const day = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); day.setUTCMonth(day.getUTCMonth() + months); return day.toISOString().slice(0, 10); };
/** The years a yearly report can be opened for: from the first year in the system to this year, newest first. */
const FIRST_YEAR = 2022;
const reportYears = () => Array.from({ length: Number(manilaToday().slice(0, 4)) - FIRST_YEAR + 1 }, (_, index) => String(Number(manilaToday().slice(0, 4)) - index));
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
export function ClerkReport({ kind, review = false, employeeId: fixedEmployee, date: fixedDate, to: fixedTo, branch: sharedBranch, onBranchChange, hideEmptyBranches = false }: { kind: Kind; review?: boolean; employeeId?: string; date?: string; to?: string; branch?: string; onBranchChange?: (branch: string) => void; hideEmptyBranches?: boolean }) {
  const [date, setDate] = useState(fixedDate ?? manilaToday());
  // Weekly and monthly reports the clerk submits (owner, October 30, 2026; lib/report-periods.ts): `to` is the last day
  // of a new weekly, or the last weekly a new monthly covers; "" shows the report containing `date`.
  const [to, setTo] = useState(fixedTo ?? "");
  const submitted = kind === "weekly" || kind === "monthly";
  // A past calendar week or month, view only (to = "calendar"; owner, November 26, 2026: clerks could open only their
  // submitted weeklies and monthlies, so no earlier week or month).
  const calendar = submitted && to === "calendar";
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  // Reports are per branch (owner, October 13, 2026): "" = the clerk's primary branch, "all" = every branch (Audits).
  // The tabs share the choice through `branch` / `onBranchChange`.
  const [ownBranch, setOwnBranch] = useState("");
  const branch = sharedBranch ?? ownBranch;
  const setBranch = onBranchChange ?? setOwnBranch;
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  // The last save on the record panel, shown under its form too (the page message is at the top, out of view).
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showEntries, setShowEntries] = useState(review);
  const [open, setOpen] = useState("");
  const [remark, setRemark] = useState("");
  // A deposit opened for editing in the record panel (owner, October 13, 2026: edit it, or void it).
  const [editingDeposit, setEditingDeposit] = useState<Report["deposits"][number] | null>(null);
  // An expense opened for editing (owner, October 16, 2026: edit or delete expenses on the report, as deposits).
  const [editingExpense, setEditingExpense] = useState<Report["expenses"][number] | null>(null);
  // Remitted to Finance (owner, November 25, 2026; called Give to Finance until November 27): opens Cash to Finance with the Remaining Cash on Hand filled in.
  const [financeRequest, setFinanceRequest] = useState(0);
  // A Fidelity entry (handed in after encoding) opened for editing (October 13, 2026).
  const [editingFidelity, setEditingFidelity] = useState<Report["fidelitySlips"][number] | null>(null);
  // Every entry filters (owner, October 14, 2026): kind, remitted / returned / missing photo, OR search, MAS, program.
  const [entryFilter, setEntryFilter] = useState<EntryFilter>(NO_FILTER);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, date, ...(submitted && to ? { to } : {}), ...(employeeId ? { employeeId } : {}), ...(branch ? { branch } : {}) });
      const response = await fetch(`/api/clerk-report?${params}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to build the report.");
      setData(result);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to build the report.");
    } finally {
      setLoading(false);
    }
  }, [kind, date, to, submitted, employeeId, branch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the period or clerk changes
    void load();
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  // Everything the report shows (owner, October 23, 2026: any change that the report reflects must update it).
  useLiveRefresh(["sales", "collections", "remittances", "remittance_collections", "expenses", "cash_transactions", "bank_deposits", "daily_audits", "weekly_audits", "monthly_audits", "yearly_audits", "report_remarks", "report_notes",
    "members", "member_programs", "programs", "program_incentives", "receipt_photos", "employees", "branches", "remittance_methods"], load, 30000);

  /** Sends one of the clerk's own report actions, then reloads the report. */
  // Never fails silently (owner, October 24, 2026: Save did nothing): a reply that is not the route's own (a time-out,
  // an upload too large, an expired sign-in) or no connection is shown as a message; what was typed stays.
  // A weekly's or monthly's notes, Cash Beg and lock follow its first day; the other reports any day in them.
  const reportDate = submitted ? data?.report.from ?? date : date;
  const act = async (body: Record<string, unknown>) => {
    setMessage(""); setSaved(null); setSaving(true);
    try {
      const response = await fetch("/api/clerk-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, date: reportDate, reportKind: kind, reportDate, reportTo: data?.report.to ?? "", branch: data?.branch === "all" ? "" : data?.branch ?? "", ...body }) });
      const result = await readApiResponse(response) as { success?: boolean; message?: string };
      const ok = response.ok && Boolean(result.success);
      const text = result.message || (ok ? "Saved." : "Unable to save.");
      setMessage(text); setSaved({ ok, text });
      if (ok) await load();
      return ok;
    } catch (caught) {
      const text = caught instanceof Error && caught.message !== "Failed to fetch" ? caught.message : "Not saved: no connection to the server. Check the internet and try again.";
      setMessage(text); setSaved({ ok: false, text });
      return false;
    } finally {
      setSaving(false);
    }
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
  // Finance wording (owner, November 27, 2026, from the approved mockup): reports from December 1, 2026; earlier ones keep the old names.
  const fin = Boolean(report && finWording(report));
  const own = Boolean(data?.isOwn && !review && !calendar);
  // An approved report is locked for the clerk until an Administrator allows editing it (lib/daily-audit.ts).
  const editable = own && !data?.audit.lock;
  const entries = report ? filterEntries(report.entries, entryFilter) : [];
  const filtering = JSON.stringify(entryFilter) !== JSON.stringify(NO_FILTER);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        {submitted ? <PeriodPicker kind={kind} view={data?.period ?? null} date={date} fixed={Boolean(fixedDate)} onPick={(start, end) => { setDate(start); setTo(end); }} />
          : kind === "yearly" ? <label className="text-sm">Year
            <select className="mt-1 block h-9 w-32 rounded-md border bg-background px-3 text-sm" value={date.slice(0, 4)} disabled={Boolean(fixedDate)} onChange={(event) => setDate(`${event.target.value}-01-01`)}>
              {[...new Set([...reportYears(), date.slice(0, 4)])].sort().reverse().map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          : <label className="text-sm">Day
            <Input className="mt-1 w-44" type="date" max={manilaToday()} value={date} disabled={Boolean(fixedDate)} onChange={(event) => event.target.value && setDate(event.target.value)} />
          </label>}
        {!fixedDate && <StepButtons kind={kind} date={date} to={to} view={data?.period ?? null} shown={report ? { from: report.from, to: report.to } : null} disabled={loading} onPick={(start, end) => { setDate(start); setTo(end); }} />}
        {data?.canChoose && !fixedEmployee && (
          <label className="text-sm">Entry Clerk
            <select className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm" value={employeeId || report?.encoder.employeeId || ""} onChange={(event) => { setEmployeeId(event.target.value); setBranch(""); }}>
              {data.clerks.map((clerk) => <option key={clerk.employeeId} value={clerk.employeeId}>{clerk.name}{clerk.branch ? ` · ${clerk.branch}` : ""}</option>)}
            </select>
          </label>
        )}
        {data && !(sharedBranch !== undefined && !onBranchChange) && (
          <label className="text-sm">Branch
            <select className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm" value={data.branch} onChange={(event) => setBranch(event.target.value)}>
              {/* Audits (hideEmptyBranches): only the branches with something in the period, and the one chosen. */}
              {data.branchChoices.filter((name) => !hideEmptyBranches || name === data.branch || data.report.activeBranches.some((active) => active.toLowerCase() === name.toLowerCase())).map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="all">All branches</option>
            </select>
          </label>
        )}
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        <Button type="button" variant="outline" disabled={!report} onClick={() => window.print()}><Printer className="size-4" />Print</Button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showEntries} onChange={(event) => setShowEntries(event.target.checked)} />Show every entry</label>
      </div>

      {message && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">{message}</p>}
      {data && calendar && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">Viewing {report ? spanLabel(report.from, report.to) : "a past period"}: a calendar {kind === "weekly" ? "week" : "month"}, view only. Nothing can be recorded or submitted here; choose a report from the list to work on it.</p>}
      {data && submitted && data.period && !calendar && <PeriodNotice kind={kind} view={data.period} own={own} saving={saving}
        onChangeDates={async (from, to) => { if (await act({ action: "change-period-dates", from, to })) { setDate(from); setTo(to); } }}
        onSubmit={async () => { const draft = data.period?.draft; if (!draft) return; if (await act({ action: "submit-period", from: draft.start, to: draft.end })) { setDate(draft.start); setTo(draft.end); } }}
        onResubmit={async (from, to) => { if (await act({ action: "resubmit-period", from, to }) && from && to) { setDate(from); setTo(to); } }} />}
      {data && own && <AuditNotice audit={data.audit} />}

      {report && (
        <div className="clerk-report-sheet rounded-xl border bg-card p-3 text-[13px] text-card-foreground print:border-0 print:p-0">
          {/* Fits the screen, no sideways scroll (owner, October 13, 2026): sections stack on narrow screens; print keeps the paper layout. */}
          <div className="min-w-0 space-y-3">
            <ReportHeader report={report} />

            <div className="grid gap-3 xl:grid-cols-2 print:grid-cols-2">
              <EntryTable title={fin ? "New Membership Sales" : "New Sales Section"} fin={fin} color={tone.sales} groupLabel={report.groupLabel} rows={report.newSales.rows} total={report.newSales.total} />
              <EntryTable title={fin ? "Collections on Accounts" : "Collections Section"} fin={fin} color={tone.collections} groupLabel={report.groupLabel} rows={report.collection.rows} total={report.collection.total} />
            </div>

            <div className="grid gap-3 xl:grid-cols-2 print:grid-cols-2">
              <Grid title={fin ? "Operating Expenses" : "Expenses/Other Cash Out Section"} color={tone.expenses}
                headers={fin ? ["Expense account", report.whenLabel, "Amount", "Receipt / voucher no.", "Purpose", "Remarks"] : ["Account Name/Type of Expense", report.whenLabel, "Amount", "Receipt/CV", "Purpose", "Rmks"]}
                rows={report.expenses.map((item) => [item.account === BURIAL_ACCOUNT && item.payee ? `${item.account}: ${item.payee}` : item.account, item.when, money(item.amount), item.receipt, item.purpose, item.remarks])}
                total={report.expenseTotal}
                action={(index) => <span className="flex flex-wrap items-center justify-center gap-2 print:hidden">
                  {/* Receipt photos (owner, October 21, 2026: required for every expense on the report). */}
                  {report.expenses[index].photoIds.map((photoId, photo) => <ReceiptPhotoView key={photoId} photoId={photoId} label={report.expenses[index].photoIds.length > 1 ? `Receipt ${photo + 1}` : "Receipt"} />)}
                  {!report.expenses[index].photoIds.length && <span className="text-xs text-amber-700 dark:text-amber-400">No receipt photo</span>}
                  {editable && <><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingExpense(report.expenses[index]); setTimeout(() => document.getElementById("expense-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={async () => { const reason = await promptDialog("Why is this expense being deleted?", { required: true }); if (reason) void act({ action: "delete-expense", id: report.expenses[index].id, reason }); }}>Delete</button></>}
                </span>} />
              <Grid title={fin ? "Bank Deposits and Cash Remitted to Finance" : "Cash Flow Transaction and Other Cash Ins"} color={tone.cashFlow}
                headers={fin ? ["Bank account / received by", report.whenLabel, "Amount", "Transfer type", "MAS", "Remarks"] : ["Bank Account / Received by", report.whenLabel, "Amount", "Type of Transfer", "MAS", "Rmks"]}
                rows={report.cashFlowTotals
                  // Monthly and yearly: the total of each week / month (owner, October 20, 2026); deposits are edited on the daily or weekly report.
                  ? report.cashFlowTotals.map((item) => [item.bankAccount, item.when, money(item.amount), item.transferType, item.mas, `${item.count} deposit${item.count === 1 ? "" : "s"}`])
                  : report.deposits.map((item) => [item.bankAccount, item.when, money(item.amount), item.transferType, item.mas, [item.remarks, financeLabel(item)].filter(Boolean).join(" · ")])}
                total={report.depositTotal}
                action={editable && !report.cashFlowTotals ? (index) => <span className="flex gap-2 print:hidden"><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingDeposit(report.deposits[index]); setTimeout(() => document.getElementById(isFinanceTurnover(report.deposits[index]) ? "finance-form" : "deposit-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={async () => { const reason = await promptDialog("Why is this deposit being voided?", { required: true }); if (reason) void act({ action: "void-deposit", id: report.deposits[index].id, reason }); }}>Void</button></span> : undefined} />
            </div>

            {(report.fidelityReceived.length > 0 || own) && (
              // Every Fidelity received: with a batch, or handed in after encoding; the total is the Fidelity Bond line.
              <Grid title={fin ? "Fidelity Bond Contributions Received" : "Fidelity received"} color={tone.cashFlow}
                headers={["MAS", report.whenLabel, "Amount", "Status", fin ? "Remarks" : "Rmks", "Ref"]}
                rows={report.fidelityReceived.map((item) => [item.masName, item.when, money(item.amount), item.status, item.remarks, item.id])}
                total={report.cash.fidelity}
                action={editable ? (index) => { const item = report.fidelitySlips.find((slip) => slip.id === report.fidelityReceived[index].id); return item && ["Pending Approval", "Discrepancy"].includes(item.status) ? <span className="flex gap-2 print:hidden"><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingFidelity(item); setTimeout(() => document.getElementById("fidelity-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={async () => { const reason = await promptDialog("Why is this Fidelity entry being voided?", { required: true }); if (reason) void act({ action: "void-fidelity", id: item.id, reason }); }}>Void</button></span> : null; } : undefined} />
            )}

            {(report.turnover.encoded.length > 0 || report.turnover.settled.length > 0) && (
              // Each turnover difference behind the Turnover lines; an open one stops the audit approval.
              <Grid title={`${fin ? "Cash Short / Over on Turnover" : "Turnover short/over"}${report.turnover.openCount ? ` (${report.turnover.openCount} not settled: the report cannot be approved yet)` : ""}`} color={tone.cashFlow}
                headers={fin ? ["MAS", "Batch", "Turnover sheet", "Encoded", "Short / over", "Status", "Remarks", "Ref"] : ["MAS", "Batch", "Sheet", "Entries", "Short/over", "Status", "Rmks", "Ref"]}
                rows={[
                  ...report.turnover.encoded.map((item) => [item.mas, `${item.kind} ${showDate(item.dateRemitted)}`, money(item.controlTotal), money(item.systemTotal), money(item.difference), item.status === "Open" ? "Not settled" : item.settlement || "Settled", item.resolution || item.note, item.id]),
                  ...report.turnover.settled.map((item) => [item.mas, `Settled ${showDate(item.settledOn)}`, "", "", money(item.amount), item.settlement, item.resolution, item.id]),
                ]}
                total={Math.round((report.cash.turnoverShortOver + report.cash.turnoverSettled) * 100) / 100} />
            )}

            <div className="grid gap-3 lg:grid-cols-[1.1fr_0.8fr_1.6fr] print:grid-cols-[1.1fr_0.8fr_1.6fr]">
              {fin ? <CashPosition report={report} giveToFinance={editable && data?.branch !== "all" && report.cash.remainingCashOnHand > 0
                ? () => { setFinanceRequest((count) => count + 1); setTimeout(() => document.getElementById("finance-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); } : null} /> :
              <dl className="space-y-0.5">
                <Cash label={report.cash.carries && !report.cash.openingMissing ? "Cash on hand at start (carried)" : "Cash Beg/Pending COH"} value={report.cash.cashBeg} color={tone.cashBeg} />
                {/* From December 1, 2026 the opening cash is carried from Finance-confirmed cash counts (lib/cash-position.ts). */}
                {report.cash.carries && report.cash.carriedFrom.length > 0 && <p className="text-right text-[11px] text-muted-foreground">Carried from the cash count{report.cash.carriedFrom.length > 1 ? "s" : ""} {report.cash.carriedFrom.map((count) => `${count.branch} ${showDate(count.date)} ${money(count.amount)}`).join("; ")}</p>}
                {report.cash.openingMissing && <p className="text-right text-[11px] font-semibold text-amber-700 dark:text-amber-400">No cash count confirmed yet for this branch: record your count on the Cash count tab. Until Finance confirms it, the typed Cash Beg is used.</p>}
                {report.cash.cashBegEdit && <p className="text-right text-[11px] text-muted-foreground">Typed by {report.cash.cashBegEdit.updatedBy}: {report.cash.cashBegEdit.reason}</p>}
                <Cash label="Sales Net" value={report.cash.salesNet} />
                <Cash label="Collection Net" value={report.cash.collectionNet} />
                {report.cash.nonCashNet !== 0 && <p className="flex justify-between gap-6 text-xs text-muted-foreground"><span>Bank / e-wallet (not cash, not counted)</span><span className="w-28 text-right">{money(report.cash.nonCashNet)}</span></p>}
                <Cash label="Fidelity Bond" value={report.cash.fidelity} />
                <Cash label="Penalty" value={report.cash.penalty} />
                {/* The turnover sheet short (−) or over (+) on the clerk's batches, and cash that settled one (lib/turnover-variance.ts). */}
                {(report.cash.turnoverShortOver !== 0 || report.turnover.encoded.length > 0) && <Cash label="Turnover short/over" value={report.cash.turnoverShortOver} color={report.cash.turnoverShortOver ? "text-amber-700" : ""} />}
                {report.cash.turnoverSettled !== 0 && <Cash label="Turnover settled" value={report.cash.turnoverSettled} />}
                {(report.cash.wholeAmountAdded ?? 0) !== 0 && <Cash label="Added to remit the whole amount" value={report.cash.wholeAmountAdded} />}
                <Cash label="Pending cash, to be encoded" value={report.cash.pendingCash} />
                <Cash label="Total Cash In" value={report.cash.totalCashIn} color={tone.cashIn} strong />
                <div className="h-2" />
                <Cash label="Expenses" value={report.cash.expenses} />
                <Cash label="Cash forwarded to bank" value={report.cash.forwardedToBank} />
                {(report.cash.turnedOverToFinance ?? 0) !== 0 && <Cash label="Cash turned over to Finance" value={report.cash.turnedOverToFinance} />}
                {report.cash.nonCashRecorded !== 0 && <p className="flex justify-between gap-6 text-xs text-muted-foreground"><span>Non-cash records (not counted)</span><span className="w-28 text-right">{money(report.cash.nonCashRecorded)}</span></p>}
                <Cash label="Total Cash Out/Expense" value={report.cash.totalCashOut} color={tone.cashOut} strong />
                <div className="h-2" />
                <Cash label="Remaining Cash on Hand" value={report.cash.remainingCashOnHand} color={tone.remaining} strong />
                {editable && data?.branch !== "all" && report.cash.remainingCashOnHand > 0 && <div className="flex justify-end print:hidden">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setFinanceRequest((count) => count + 1); setTimeout(() => document.getElementById("finance-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); }}
                    title="Opens the Remitted to Finance tab with the ending cash on hand filled in: type who in Finance received it and save; change the amount if you remit less and the rest is carried to the next day">Remitted to Finance</Button></div>}
                <div className="flex justify-end gap-6 pt-3 font-bold italic"><span>TOTALS</span><span className="w-28 text-right">{money(report.cash.totals)}</span></div>
              </dl>}
              <NoteBox title={fin ? "Remarks" : "Specific Rmks"} text={report.notes.specificRemarks} />
              <div className="space-y-3">
                <NoteBox title={fin ? "Open items" : "Pending Transactions:"} text={report.notes.pendingTransactions} />
                <NoteBox title={fin ? "Other notes" : "Other Comments/Rmks"} text={report.notes.otherComments} />
              </div>
            </div>
          </div>
        </div>
      )}

      {report && kind !== "daily" && <MasSummary report={report} fin={fin} />}

      {report && editable && data?.branch !== "all" && <RecordPanel key={`${report.kind}-${report.from}-${report.branch}-${editingDeposit?.id ?? ""}-${editingFidelity?.id ?? ""}-${editingExpense?.id ?? ""}`} report={report} cashCounts={data?.cashCounts ?? []} act={act} saved={saved} saving={saving} editing={editingDeposit} onEditDone={() => setEditingDeposit(null)}
        editingExpense={editingExpense} onExpenseDone={() => setEditingExpense(null)}
        masChoices={data?.masChoices ?? []} editingFidelity={editingFidelity} onFidelityDone={() => setEditingFidelity(null)} financeRequest={financeRequest} />}
      {report && editable && data?.branch === "all" && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">Choose one branch to record expenses, deposits, Cash Beg and notes for it.</p>}

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
        // Every entry (owner, October 13, 2026): fits the screen (each entry one row whose parts wrap), folds open and
        // closed, and scrolls inside its own card.
        <details open className="group rounded-lg border print:break-before-page">
          <summary className="flex cursor-pointer items-center justify-between gap-2 p-3 font-semibold">
            <span>Every entry ({filtering ? `${entries.length} of ` : ""}{report.checks.entryCount}){report.entriesTruncated ? ", first 1,000 shown" : ""}</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180 print:hidden" />
          </summary>
          <EntryFilters entries={report.entries} filter={entryFilter} onChange={setEntryFilter} />
          <div className="max-h-[36rem] divide-y overflow-y-auto border-t text-xs sm:text-sm print:max-h-none print:overflow-visible">
            {entries.map((entry) => (
              <div key={entry.id} className="p-2">
                <div className="grid items-start gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold">{entry.kind}</span>
                    <span className="block break-all font-mono text-xs">{entry.id}</span>
                    <span className="block text-xs text-muted-foreground">Encoded {entry.encodedAt}</span>
                    {entry.warnings.length > 0 && <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="size-3" />{entry.warnings.length} date warning{entry.warnings.length === 1 ? "" : "s"}</span>}
                  </div>
                  <div className="min-w-0">
                    <span className="block">{entry.orNumber || (entry.applicationNumber ? `App ${entry.applicationNumber}` : "—")}</span>
                    <span className="block text-xs text-muted-foreground">OR / app date {showDate(entry.orDate) || "—"} · remitted {showDate(entry.dateRemitted) || "—"}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="block break-words">{entry.memberName || "—"}</span>
                    <span className="block text-xs text-muted-foreground">{entry.memberNumber} · {entry.person}</span>
                  </div>
                  <div className="min-w-0 tabular-nums lg:text-right">
                    <span className="block">{money(entry.amount)}</span>
                    <span className="block text-xs text-muted-foreground">Incentive {money(entry.incentive)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <StatusBadge status={entry.remittanceStatus || "Not set"} />
                    {entry.photoId ? <ReceiptPhotoView photoId={entry.photoId} label="View" /> : <StatusBadge status="Missing" tone="warning" />}
                    <Button type="button" size="sm" variant="ghost" className="print:hidden" onClick={() => setOpen(open === entry.id ? "" : entry.id)}><Eye className="size-3.5" />Details</Button>
                  </div>
                </div>
                {open === entry.id && <div className="mt-2 rounded-lg bg-muted/20 p-3"><EntryDetails entry={entry} onClose={() => setOpen("")} /></div>}
              </div>
            ))}
            {!report.entries.length && <p className="p-6 text-center text-muted-foreground">Nothing encoded in this period.</p>}
            {report.entries.length > 0 && !entries.length && <p className="p-6 text-center text-muted-foreground">No entry matches these filters.</p>}
          </div>
        </details>
      )}

      {data && review && (
        <div className="space-y-2 rounded-lg border p-3 print:hidden">
          <p className="font-semibold">Reviewer remarks on this report</p>
          {data.remarks.map((item) => <p key={item.id} className="text-sm"><span className="text-muted-foreground">{showDateTime(item.createdAt)} · {item.encodedBy}:</span> {item.comment}</p>)}
          {!data.remarks.length && <p className="text-sm text-muted-foreground">No remarks yet.</p>}
          <div className="flex gap-2"><Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Add a remark for this clerk's report" /><Button type="button" disabled={!remark.trim()} onClick={() => void saveRemark()}>Save</Button></div>
        </div>
      )}
    </div>
  );
}

const PERIOD_STATUS = (period: ClerkPeriod) => period.auditStatus === "Approved" ? "Approved" : period.submission === "Returned" ? "Returned" : "Submitted";
const spanLabel = (start: string, end: string) => (start === end ? showDate(start) : `${showDate(start)} – ${showDate(end)}`);
const monthLabelName = (label: string) => (/^\d{4}-\d{2}$/.test(label) ? new Date(`${label}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : label);
// A weekly's place in its month (November 12, 2026): "Week 2 of October 2026".
const weekLabel = (period: { week: number; monthLabel: string }) => (period.week ? `Week ${period.week} of ${monthLabelName(period.monthLabel)}` : "");

/**
 * Which weekly or monthly report to show (owner, October 30, 2026): one the clerk submitted, or the new one. A new
 * weekly starts the day after the last (the first one on a day chosen) and ends on the day chosen, and is shown as the
 * Week N of its month it will be; a new monthly gathers the next month's weeklies, Week 1 to the last (November 12, 2026).
 */
function PeriodPicker({ kind, view, date, fixed, onPick }: { kind: Kind; view: PeriodView | null; date: string; fixed: boolean; onPick: (start: string, end: string) => void }) {
  const today = manilaToday();
  const selected = view?.calendar ? "calendar" : view?.current ? `${view.current.start}|${view.current.end}` : "new";
  const draft = view?.draft;
  return <>
    <label className="text-sm">{kind === "weekly" ? "Weekly report" : "Monthly report"}
      <select className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm" value={selected} disabled={fixed || !view}
        onChange={(event) => { const [start, end] = event.target.value.split("|"); if (event.target.value === "new") onPick(today, "new"); else if (event.target.value === "calendar") onPick(kind === "weekly" ? shiftDays(today, -7) : shiftMonths(today, -1), "calendar"); else onPick(start, end); }}>
        <option value="new">{kind === "weekly" ? "New weekly report (not submitted)" : "New monthly report (not submitted)"}</option>
        <option value="calendar">{kind === "weekly" ? "Past week, any (view only)" : "Past month, any (view only)"}</option>
        {[...(view?.periods ?? [])].reverse().map((period) => <option key={period.id} value={`${period.start}|${period.end}`}>
          {kind === "monthly" && period.monthLabel ? `${monthLabelName(period.monthLabel)} · ` : ""}{kind === "weekly" && period.week ? `${weekLabel(period)} · ` : ""}{spanLabel(period.start, period.end)} · {PERIOD_STATUS(period)}
        </option>)}
      </select>
    </label>
    {view?.calendar && !fixed && <label className="text-sm">{kind === "weekly" ? "Any day of the week" : "Month"}
      {kind === "weekly"
        ? <Input className="mt-1 w-40" type="date" max={today} value={date} onChange={(event) => event.target.value && onPick(event.target.value, "calendar")} />
        : <Input className="mt-1 w-40" type="month" max={today.slice(0, 7)} value={date.slice(0, 7)} onChange={(event) => event.target.value && onPick(`${event.target.value}-01`, "calendar")} />}
    </label>}
    {draft && !fixed && kind === "weekly" && <>
      <label className="text-sm">From
        {draft.chooseStart
          ? <Input className="mt-1 w-40" type="date" max={today} value={draft.start} onChange={(event) => event.target.value && onPick(event.target.value, draft.end)} />
          : <span className="mt-1 flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm" title="The day after your last weekly report">{showDate(draft.start)}</span>}
      </label>
      <label className="text-sm">To
        <Input className="mt-1 w-40" type="date" min={draft.start} max={today} value={draft.end} onChange={(event) => event.target.value && onPick(draft.start, event.target.value)} />
      </label>
      {draft.week > 0 && <span className="text-sm"><span className="block">This will be</span><span className="mt-1 flex h-9 items-center rounded-md border bg-muted/40 px-3 font-semibold">{weekLabel(draft)}</span></span>}
    </>}
  </>;
}

/**
 * Previous and Next (owner, November 26, 2026: clerks could not go back to an earlier weekly, monthly or yearly report).
 * Daily: a day; yearly: a year; a past calendar week or month: a week or a month; a submitted weekly or monthly: the
 * report before or after it in the list, Previous from the new report opening the latest submitted one and Next from the
 * latest opening the new one.
 */
function StepButtons({ kind, date, to, view, shown, disabled, onPick }: { kind: Kind; date: string; to: string; view: PeriodView | null; shown: { from: string; to: string } | null; disabled: boolean; onPick: (start: string, end: string) => void }) {
  const today = manilaToday();
  const target = (direction: -1 | 1): [string, string] | null => {
    if (kind === "daily") { const day = shiftDays(date, direction); return day > today ? null : [day, ""]; }
    if (kind === "yearly") { const year = Number(date.slice(0, 4)) + direction; return year < FIRST_YEAR || year > Number(today.slice(0, 4)) ? null : [`${year}-01-01`, ""]; }
    // A report week stops at the month's ends (Oct 1-4, 5-11 ... 26-31; lib/report-week.ts), so the next one starts the
    // day after the week shown and the previous one ends the day before it.
    if (to === "calendar") {
      const day = kind === "monthly" ? shiftMonths(date, direction) : shown ? shiftDays(direction < 0 ? shown.from : shown.to, direction) : "";
      return !day || day > today ? null : [day, "calendar"];
    }
    const periods = view?.periods ?? [];
    const at = view?.current ? periods.findIndex((period) => period.id === view.current!.id) : periods.length;
    const next = at + direction;
    if (next < 0) return null;
    if (next >= periods.length) return view?.current ? [today, "new"] : null;
    return [periods[next].start, periods[next].end];
  };
  const back = target(-1), forward = target(1);
  const unit = kind === "daily" ? "day" : kind === "yearly" ? "year" : to === "calendar" ? (kind === "weekly" ? "week" : "month") : "report";
  return <div className="flex gap-1">
    <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled || !back} onClick={() => back && onPick(...back)} title={`Previous ${unit}`}><ChevronLeft className="size-4" />Previous</Button>
    <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled || !forward} onClick={() => forward && onPick(...forward)} title={`Next ${unit}`}>Next<ChevronRight className="size-4" /></Button>
  </div>;
}

/** Where the weekly or monthly report stands: not submitted (with Submit), submitted, returned (with Submit again), approved. */
function PeriodNotice({ kind, view, own, saving, onSubmit, onResubmit, onChangeDates }: { kind: Kind; view: PeriodView; own: boolean; saving: boolean; onSubmit: () => void; onResubmit: (from?: string, to?: string) => void; onChangeDates: (from: string, to: string) => void }) {
  const name = kind === "weekly" ? "weekly report" : "monthly report";
  const current = view.current, draft = view.draft;
  if (current) {
    const returned = current.submission === "Returned" && current.auditStatus !== "Approved";
    return <div className={`space-y-1 rounded-lg border px-4 py-3 text-sm print:hidden ${returned ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" : "bg-muted/40"}`}>
      <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{kind === "monthly" && current.monthLabel ? `${monthLabelName(current.monthLabel)}: ` : ""}{kind === "weekly" && current.week ? `${weekLabel(current)}: ` : ""}{spanLabel(current.start, current.end)}</span>
        <StatusBadge status={PERIOD_STATUS(current)} tone={current.auditStatus === "Approved" ? "success" : returned ? "warning" : "info"} />
        <span className="text-xs">submitted by {current.submittedBy} on {showDateTime(current.submittedAt)}</span></p>
      {returned ? <>
        <p><span className="font-semibold">Returned by {current.returnedBy}</span> on {showDateTime(current.returnedAt)}: {current.returnReason}</p>
        {own && (view.dates && (view.dates.canFrom || view.dates.canTo)
          ? <ReturnedDates key={`${current.start}|${current.end}`} start={current.start} end={current.end} dates={view.dates} saving={saving} onSave={onChangeDates} onResubmit={onResubmit} />
          : <p className="flex flex-wrap items-center gap-2 text-xs">Fix it, then submit it again; it is locked again once submitted.<Button type="button" size="sm" disabled={saving} onClick={() => onResubmit()}>Submit again</Button></p>)}
      </> : current.auditStatus !== "Approved" && <p className="text-xs">Submitted: locked until the audit approves it or returns it to {own ? "you" : "the clerk"}.</p>}
    </div>;
  }
  if (!draft) return null;
  return <div className="space-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">
    <p><span className="font-semibold">New {name}{kind === "weekly" && draft.week ? ` (${weekLabel(draft)})` : draft.monthLabel ? ` for ${monthLabelName(draft.monthLabel)}` : ""}:</span> {draft.weeks.length || kind === "weekly" ? spanLabel(draft.start, draft.end) : ""} · not submitted yet.</p>
    {kind === "monthly" && draft.weeks.length > 0 && <ul className="list-inside list-disc text-xs">{draft.weeks.map((week) => <li key={week.id}><span className="font-semibold">Week {week.week}</span>: {spanLabel(week.start, week.end)} · {PERIOD_STATUS(week)}</li>)}</ul>}
    {draft.problem ? <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{draft.problem}</p>
      : own && <p className="flex flex-wrap items-center gap-2 text-xs">{kind === "weekly" ? "Check the report, then submit it. Once submitted you cannot change anything in these days unless the audit returns it." : "Every weekly report in it is approved; submit the monthly report."}
        <Button type="button" size="sm" disabled={saving} onClick={onSubmit}>Submit {name}</Button></p>}
  </div>;
}

/**
 * A returned weekly's From and To (November 12, 2026; lib/report-periods.ts changeReturnedWeekly): From only on the
 * clerk's first weekly, To only on their latest, so no day is left out or counted twice. Show these days reloads the
 * report for them; Submit again submits the days in the boxes, changed or not (a clerk typed new days and submitted
 * without saving them, owner, November 12, 2026).
 */
function ReturnedDates({ start, end, dates, saving, onSave, onResubmit }: { start: string; end: string; dates: NonNullable<PeriodView["dates"]>; saving: boolean; onSave: (from: string, to: string) => void; onResubmit: (from?: string, to?: string) => void }) {
  const [from, setFrom] = useState(start), [to, setTo] = useState(end);
  const today = manilaToday(), changed = from !== start || to !== end;
  return <div className="flex flex-wrap items-end gap-2 rounded-md border border-amber-300/70 bg-background/60 p-2 text-xs dark:border-amber-800">
    <label>From
      {dates.canFrom ? <Input className="mt-1 h-8 w-40" type="date" max={to || today} value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} />
        : <span className="mt-1 flex h-8 items-center rounded-md border bg-muted/40 px-2" title={`The day after your previous weekly report (it ended ${showDate(dates.fromLimit)})`}>{showDate(start)}</span>}
    </label>
    <label>To
      {dates.canTo ? <Input className="mt-1 h-8 w-40" type="date" min={from} max={dates.toLimit || today} value={to} onChange={(event) => event.target.value && setTo(event.target.value)} />
        : <span className="mt-1 flex h-8 items-center rounded-md border bg-muted/40 px-2" title={`The day before your next weekly report (it starts ${showDate(dates.toLimit)})`}>{showDate(end)}</span>}
    </label>
    <Button type="button" size="sm" variant="outline" disabled={saving || !changed || to < from} onClick={() => onSave(from, to)}>Show these days</Button>
    <Button type="button" size="sm" disabled={saving || to < from} onClick={() => onResubmit(from, to)}>{changed ? `Submit again for ${spanLabel(from, to)}` : "Submit again"}</Button>
    <span className="basis-full text-muted-foreground">{changed ? `The report below still shows ${spanLabel(start, end)}; Show these days to check the new days first. ` : ""}{!dates.canFrom ? "The first day stays the day after your previous weekly report. " : ""}{!dates.canTo ? "The last day stays the day before your next weekly report. " : ""}So no day is left out or counted twice. It is locked again once submitted.</span>
  </div>;
}

/**
 * The audit of the clerk's own report (owner, October 27, 2026: clerks could not tell whether it was approved or had
 * findings): its status, the result and findings once approved, and whether the report is locked.
 */
function AuditNotice({ audit }: { audit: ClerkAuditView }) {
  const approved = audit.status === "Approved";
  const findings = approved && audit.result === "With findings";
  const box = findings ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
    : approved ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "bg-muted/40";
  return (
    <div className={`space-y-1 rounded-lg border px-4 py-3 text-sm print:hidden ${box}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Audit:</span>
        <StatusBadge status={approved ? `Approved · ${audit.result}` : audit.status === "Draft" ? "Being audited" : "Not audited yet"} tone={findings ? "warning" : approved ? "success" : audit.status === "Draft" ? "info" : "neutral"} />
        {approved && <span className="text-xs">by {audit.approvedByName} on {showDateTime(audit.approvedAt)}</span>}
      </p>
      {findings && <div><p className="text-xs font-semibold">Findings</p><p className="whitespace-pre-wrap">{audit.findings}</p></div>}
      {approved && !findings && audit.findings && <p className="whitespace-pre-wrap text-xs">{audit.findings}</p>}
      {audit.lock ? <p className="text-xs font-medium">{audit.lock}</p>
        : audit.editAllowed ? <p className="text-xs font-medium">{audit.editAllowed.byName} allowed you to edit this report ({showDateTime(audit.editAllowed.at)}): {audit.editAllowed.reason}</p>
        : null}
    </div>
  );
}

type Entry = Report["entries"][number];
type EntryFilter = { kind: "" | Entry["kind"]; status: "" | "Remitted" | "Returned" | "Missing photo"; search: string; mas: string; program: string };
const NO_FILTER: EntryFilter = { kind: "", status: "", search: "", mas: "", program: "" };
const ENTRY_STATUSES: Array<[EntryFilter["status"], string]> = [["", "Any status"], ["Remitted", "Remitted"], ["Returned", "Returned"], ["Missing photo", "Missing receipt photo"]];

/** The entries that pass every filter; the search matches OR and application numbers. */
function filterEntries(entries: Entry[], filter: EntryFilter) {
  const search = filter.search.trim().toLowerCase();
  return entries.filter((entry) => (!filter.kind || entry.kind === filter.kind)
    && (!filter.status || (filter.status === "Missing photo" ? !entry.photoId : entry.remittanceStatus === filter.status))
    && (!search || entry.orNumber.toLowerCase().includes(search) || entry.applicationNumber.toLowerCase().includes(search))
    && (!filter.mas || (entry.person || "(no MAS)") === filter.mas)
    && (!filter.program || entry.program === filter.program));
}

/** The filter bar above Every entry; MAS and program choices come from the period's entries. */
function EntryFilters({ entries, filter, onChange }: { entries: Entry[]; filter: EntryFilter; onChange: (filter: EntryFilter) => void }) {
  const choices = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const masChoices = choices(entries.map((entry) => entry.person || "(no MAS)"));
  const programChoices = choices(entries.map((entry) => entry.program).filter(Boolean));
  const set = (change: Partial<EntryFilter>) => onChange({ ...filter, ...change });
  const select = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 print:hidden">
      <div className="flex overflow-hidden rounded-md border text-sm" role="group" aria-label="Entry kind">
        {([["", "All"], ["New Sale", "New Sales only"], ["Collection", "Collections only"]] as const).map(([value, label]) => (
          <button key={label} type="button" aria-pressed={filter.kind === value} onClick={() => set({ kind: value })}
            className={`px-2.5 py-1 ${filter.kind === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>
        ))}
      </div>
      <select className={select} aria-label="Status" value={filter.status} onChange={(event) => set({ status: event.target.value as EntryFilter["status"] })}>
        {ENTRY_STATUSES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
      </select>
      <Input className="h-8 w-48" placeholder="Search OR / app number" value={filter.search} onChange={(event) => set({ search: event.target.value })} />
      <select className={select} aria-label="MAS" value={filter.mas} onChange={(event) => set({ mas: event.target.value })}>
        <option value="">Every MAS</option>{masChoices.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <select className={select} aria-label="Program" value={filter.program} onChange={(event) => set({ program: event.target.value })}>
        <option value="">Every program</option>{programChoices.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {JSON.stringify(filter) !== JSON.stringify(NO_FILTER) && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(NO_FILTER)}>Clear filters</Button>}
    </div>
  );
}

function ReportHeader({ report }: { report: Report }) {
  return (
    <div className="grid items-center gap-3 border-b pb-2 sm:grid-cols-[1fr_auto] lg:grid-cols-[1fr_auto_auto_1.1fr] print:grid-cols-[1fr_auto_auto_1.1fr]">
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

function EntryTable({ title, fin, color, groupLabel, rows, total }: { title: string; fin: boolean; color: string; groupLabel: string; rows: ReportLine[]; total: ReportLine }) {
  const cells = (line: ReportLine) => [String(line.accounts || "-"), money(line.gross), money(line.incentives), money(line.net), money(line.fidelity), money(line.penalty)];
  const filler = Math.max(0, 5 - rows.length);
  return (
    <table className="w-full border-collapse border text-[12px]">
      <thead>
        <tr><th colSpan={7} className={`p-1 text-center font-bold ${color}`}>{title}</th></tr>
        <tr className="border-b">{(fin ? [groupLabel, "Accounts", "Gross", "Incentives", "Net", "Fidelity bond", "Penalty"] : [groupLabel, "Accts", "Gross", "Inc", "Net", "Fid/ bond", "Penalty"]).map((header, index) => <th key={header} className={`border-r p-1 font-semibold ${index ? "text-right" : "text-left"} ${index === 5 ? "text-[10px] italic" : ""}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((line) => <tr key={line.label} className="border-b"><td className="break-words border-r p-1 font-medium">{line.label}<NonCashLabels line={line} /></td>{cells(line).map((value, index) => <td key={index} className="border-r p-1 text-right tabular-nums">{value}</td>)}</tr>)}
        {Array.from({ length: filler }, (_, index) => <tr key={`filler-${index}`} className="h-6 border-b">{Array.from({ length: 7 }, (__, cell) => <td key={cell} className="border-r" />)}</tr>)}
        <tr className={`font-bold ${color}`}><td className="p-1.5 text-center">Total</td>{cells(total).map((value, index) => <td key={index} className="p-1.5 text-right tabular-nums">{value}</td>)}</tr>
      </tbody>
    </table>
  );
}

/**
 * The bank or e-wallet label on a row (owner, November 27, 2026, as in the approved mockup): each method that paid part
 * of the row and its net, e.g. GCash 400.00. That part is in the row's figures but not in the cash summary (memo).
 */
function NonCashLabels({ line }: { line: ReportLine }) {
  const methods = Object.entries(line.nonCash ?? {}).filter(([, net]) => net !== 0);
  if (!methods.length) return null;
  return <>{methods.map(([method, net]) => <span key={method} title={`${money(net)} of this row was paid by ${method}: not cash, so it is left out of the cash summary (see the memo).`}
    className="ml-1 inline-block whitespace-nowrap rounded border border-sky-300 bg-sky-50 px-1 text-[10px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 print:border-neutral-500 print:bg-transparent print:text-black">{method} {money(net)}</span>)}</>;
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
        {rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b">{row.map((value, index) => <td key={index} className={`break-words border-r p-1 ${index === 2 ? "text-right tabular-nums" : "text-center"}`}>{value}{index === 5 && action?.(rowIndex)}</td>)}</tr>)}
        {Array.from({ length: filler }, (_, index) => <tr key={`filler-${index}`} className="h-6 border-b">{Array.from({ length: 6 }, (__, cell) => <td key={cell} className="border-r" />)}</tr>)}
        <tr className="font-bold"><td className={`p-1.5 text-center ${tone.total}`}>Total</td><td className="bg-neutral-900" /><td className="p-1.5 text-right tabular-nums">{money(total)}</td><td colSpan={3} className="bg-neutral-900" /></tr>
      </tbody>
    </table>
  );
}

/**
 * The finance wording and the cash position statement (owner, November 27, 2026, from the approved mockup): reports
 * from December 1, 2026, the day the opening cash is carried from cash counts (CARRY_START). Earlier reports keep the old names.
 */
function finWording(report: Report) { return report.from >= CARRY_START; }

/**
 * The cash summary as a cash position statement: Opening cash balance + Cash receipts − Cash disbursements = Ending cash
 * on hand. Same figures as the old box (lib/clerk-report.ts); Total cash receipts and Net cash flow are added, TOTALS
 * (it repeated Total Cash In) is dropped, and bank / e-wallet and non-cash records move to a memo, not counted.
 */
/** Finance's check of cash remitted to Finance (owner, November 27, 2026), shown in the record's remarks. */
function financeLabel(item: Report["deposits"][number]) {
  if (item.financeStatus === "Pending") return "Waiting for Finance to confirm";
  if (item.financeStatus === "Confirmed") return `Confirmed by ${item.financeDecidedBy || "Finance"}`;
  if (item.financeStatus === "Rejected") return `Not correct (${item.financeDecidedBy || "Finance"}): ${item.financeNote}. Edit the amount or void it.`;
  return "";
}

function CashPosition({ report, giveToFinance }: { report: Report; giveToFinance: (() => void) | null }) {
  const cash = report.cash;
  const receipts = Math.round((cash.totalCashIn - cash.cashBeg) * 100) / 100;
  const net = Math.round((receipts - cash.totalCashOut) * 100) / 100;
  const period = report.kind === "daily" ? "day" : report.kind === "weekly" ? "week" : report.kind === "monthly" ? "month" : "year";
  const head = (text: string) => <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{text}</p>;
  const line = (label: string, value: number, note = "", color = "") => (
    <div className="flex items-start justify-between gap-3 pl-3">
      <dt>{label}{note && <span className="block text-[11px] text-muted-foreground">{note}</span>}</dt>
      <dd className={`w-28 shrink-0 px-1 text-right tabular-nums ${color}`}>{money(value)}</dd>
    </div>
  );
  const total = (label: string, value: number, color = "", note = "") => (
    <div className="flex items-start justify-between gap-3 border-t pt-0.5 font-bold">
      <dt>{label}{note && <span className="block text-[11px] font-normal text-muted-foreground">{note}</span>}</dt>
      <dd className={`w-28 shrink-0 px-1 text-right tabular-nums ${color}`}>{money(value)}</dd>
    </div>
  );
  const memo = cash.nonCashNet !== 0 || cash.nonCashRecorded !== 0;
  return (
    <dl className="space-y-0.5">
      <div className="flex items-start justify-between gap-3 font-bold"><dt>Opening cash balance</dt><dd className={`w-28 shrink-0 px-1 text-right tabular-nums ${tone.cashBeg}`}>{money(cash.cashBeg)}</dd></div>
      {cash.carries && cash.carriedFrom.length > 0 && <p className="text-right text-[11px] text-muted-foreground">Carried from the cash count{cash.carriedFrom.length > 1 ? "s" : ""} {cash.carriedFrom.map((count) => `${count.branch} ${showDate(count.date)} ${money(count.amount)}`).join("; ")}</p>}
      {cash.openingMissing && <p className="text-right text-[11px] font-semibold text-amber-700 dark:text-amber-400">No cash count confirmed yet for this branch: record your count on the Cash count tab. Until Finance confirms it, the typed opening balance is used.</p>}
      {cash.cashBegEdit && <p className="text-right text-[11px] text-muted-foreground">Typed by {cash.cashBegEdit.updatedBy}: {cash.cashBegEdit.reason}</p>}

      {head("Cash receipts")}
      {line("New membership sales", cash.salesNet, Object.keys(report.newSales.total.nonCash ?? {}).length ? "net of incentives, cash only" : "net of incentives")}
      {line("Collections on accounts", cash.collectionNet, Object.keys(report.collection.total.nonCash ?? {}).length ? "net of incentives, cash only" : "net of incentives")}
      {line("Fidelity bond contributions", cash.fidelity)}
      {line("Penalties collected", cash.penalty)}
      {(cash.turnoverShortOver !== 0 || report.turnover.encoded.length > 0) && line("Cash short / over on turnover", cash.turnoverShortOver, "short is negative, over is positive", cash.turnoverShortOver ? "text-amber-700 dark:text-amber-400" : "")}
      {cash.turnoverSettled !== 0 && line("Short / over settled", cash.turnoverSettled)}
      {(cash.wholeAmountAdded ?? 0) !== 0 && line("Added to remit the whole amount", cash.wholeAmountAdded, "centavos added when remitting whole pesos to Finance")}
      {cash.pendingCash !== 0 && line("Cash received, not yet recorded", cash.pendingCash, "typed by the clerk; to be encoded")}
      {total("Total cash receipts", receipts)}
      {total("Total cash available", cash.totalCashIn, tone.cashIn, "opening balance + total receipts")}

      {head("Cash disbursements")}
      {line("Operating expenses", cash.expenses)}
      {line("Bank deposits", cash.forwardedToBank)}
      {(cash.turnedOverToFinance ?? 0) !== 0 && line("Cash remitted to Finance", cash.turnedOverToFinance)}
      {total("Total cash disbursements", cash.totalCashOut, tone.cashOut)}

      {head("Closing")}
      {line(`Net cash flow for the ${period}`, net, "receipts − disbursements")}
      {total("Ending cash on hand", cash.remainingCashOnHand, tone.remaining, report.kind === "daily" ? "becomes the next day's opening balance" : "")}
      {giveToFinance && <div className="flex justify-end print:hidden">
        <Button type="button" size="sm" variant="outline" onClick={giveToFinance} title="Opens the Remitted to Finance tab with the ending cash on hand filled in: type who in Finance received it and save; change the amount if you remit less and the rest is carried to the next day">Remitted to Finance</Button></div>}

      {memo && <div className="mt-2 rounded border border-dashed p-2 text-xs text-muted-foreground">
        <p className="font-semibold">Memo: not counted in cash</p>
        {cash.nonCashNet !== 0 && <p className="flex justify-between gap-3"><span>Bank / e-wallet receipts</span><span className="tabular-nums">{money(cash.nonCashNet)}</span></p>}
        {cash.nonCashRecorded !== 0 && <p className="flex justify-between gap-3"><span>Non-cash transfers recorded</span><span className="tabular-nums">{money(cash.nonCashRecorded)}</span></p>}
      </div>}
    </dl>
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
function MasSummary({ report, fin }: { report: Report; fin: boolean }) {
  const line = (sales: ReportLine, collections: ReportLine) => [String(sales.accounts || ""), money(sales.gross), money(sales.incentives), String(collections.accounts || ""), money(collections.gross), money(collections.incentives)];
  // CVE (%): accounts due and amount due in the period, and Collection GROSS ÷ CVE GROSS (the sheet's G/J).
  const cve = (value: { accounts: number; gross: number; percent: number | null }) => [String(value.accounts || ""), value.gross ? money(value.gross) : "", value.percent === null ? "—" : `${value.percent.toFixed(2)}%`];
  return (
    <div className="clerk-report-sheet rounded-xl border bg-card p-3 text-[13px] text-card-foreground print:break-before-page print:border-0">
      <div className="min-w-0 space-y-2">
        <div className="bg-yellow-300 py-1 text-center font-bold leading-tight text-neutral-900">
          <p>{report.company.name}</p><p>{report.masSummary.title}</p><p>NEW MEMBER AND COLLECTION</p>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-xs">
          <p className="font-bold">{report.summaryLabel}</p>
          <dl className="grid grid-cols-[auto_minmax(0,12rem)] gap-x-2">
            <dt className="text-right">Week and Date:</dt><dd className="border-b font-semibold">{report.summaryWeek}</dd>
            <dt className="text-right">Branch Name:</dt><dd className="border-b font-semibold">{report.branch || "—"}</dd>
            <dt className="text-right">Encoder&apos;s Name:</dt><dd className="border-b font-semibold uppercase">{report.encoder.name}</dd>
          </dl>
        </div>
        <table className="w-full border-collapse border text-[11px] sm:text-[12px]">
          <thead>
            <tr><th rowSpan={2} className="border p-1">No.</th><th rowSpan={2} className="border p-1">Marketing Account Staff</th><th colSpan={3} className="border bg-orange-200 p-1 text-orange-950">NEW SALES</th><th colSpan={3} className="border bg-blue-200 p-1 text-blue-950">COLLECTION</th><th colSpan={3} className="border bg-green-200 p-1 text-green-950">{fin ? "COLLECTION EFFICIENCY" : "CVE (%)"}</th></tr>
            <tr>{(fin ? ["Accounts", "Gross", "Incentives", "Accounts", "Gross", "Incentives", "Accounts due", "Amount due", "Collected %"] : ["ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "CVE%"]).map((header, index) => <th key={`${header}-${index}`} className="border p-1 text-[11px]">{header}</th>)}</tr>
          </thead>
          <tbody>
            {report.masSummary.rows.map((row, index) => (
              <tr key={row.name}><td className="border p-1 text-center">{index + 1}</td><td className="border p-1 font-semibold">{row.name}</td>{[...line(row.sales, row.collections), ...cve(row.cve)].map((value, cell) => <td key={cell} className="border p-1 text-right tabular-nums">{value}</td>)}</tr>
            ))}
            {!report.masSummary.rows.length && <tr><td colSpan={11} className="border p-3 text-center text-muted-foreground">Nothing encoded in this period.</td></tr>}
            <tr className="bg-blue-950 font-bold text-white"><td colSpan={2} className="p-1.5 text-center">Total</td>{line(report.masSummary.total.sales, report.masSummary.total.collections).map((value, cell) => <td key={cell} className="p-1.5 text-right tabular-nums">{value}</td>)}{cve(report.masSummary.total.cve).map((value, cell) => <td key={`cve-${cell}`} className="p-1.5 text-right tabular-nums">{value}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The clerk records what the report needs besides New Sales and Collections. */
/** The form values of a saved expense: "Other: X" (accounts: "Others: X") splits into the choice and its detail; a value not on the list is its detail. */
function expenseForm(item: Report["expenses"][number]) {
  const split = (value: string, options: readonly string[], fallback: string) => {
    const other = options.includes("Others") ? "Others" : "Other";
    return options.includes(value) ? { choice: value, other: "" } : value.startsWith(`${other}: `) ? { choice: other, other: value.slice(other.length + 2) }
      : value ? { choice: other, other: value } : { choice: fallback, other: "" };
  };
  const account = split(item.account, EXPENSE_ACCOUNTS, "Transportation"), approver = split(item.approvedBy, EXPENSE_APPROVERS, "VP Finance");
  return { category: account.choice, categoryOther: account.other, date: item.date, amount: String(item.amount), receiptNumber: item.receipt, payee: item.payee, description: item.purpose, remarks: item.remarks, approvedBy: approver.choice, approvedByOther: approver.other };
}

function RecordPanel({ report, cashCounts, act, saved, saving, editing, onEditDone, masChoices, editingFidelity, onFidelityDone, editingExpense, onExpenseDone, financeRequest = 0 }: { report: Report; cashCounts: CashCount[]; act: (body: Record<string, unknown>) => Promise<boolean>; saved: { ok: boolean; text: string } | null; saving: boolean; editing: Report["deposits"][number] | null; onEditDone: () => void;
  editingExpense: Report["expenses"][number] | null; onExpenseDone: () => void;
  masChoices: Array<{ id: string; name: string }>; editingFidelity: Report["fidelitySlips"][number] | null; onFidelityDone: () => void; financeRequest?: number }) {
  const today = manilaToday();
  const inPeriod = today >= report.from && today <= report.to ? today : report.to;
  const [expense, setExpense] = useState(editingExpense ? expenseForm(editingExpense) : { category: "Transportation", categoryOther: "", date: inPeriod, amount: "", receiptNumber: "", payee: "", description: "", remarks: "", approvedBy: "VP Finance", approvedByOther: "" });
  // Photos of the expense's receipt, sent with it: at least one, unless an expense being edited already has one.
  const [expensePhotos, setExpensePhotos] = useState<PickedPhoto[]>([]);
  const savedPhotos = editingExpense?.photoIds.length ?? 0;
  const photoBodies = () => expensePhotos.map(({ dataUrl, width, height }) => ({ dataUrl, width, height }));
  // Cash turned over to Finance in person is kept like a deposit (lib/cash-turnover.ts) and edited in its own tab.
  const editingTurnover = editing && isFinanceTurnover(editing) ? editing : null;
  const editingDeposit = editing && !editingTurnover ? editing : null;
  const [deposit, setDeposit] = useState(editingDeposit
    ? { date: editingDeposit.date, bankAccount: editingDeposit.bankAccount, amount: String(editingDeposit.amount), transferType: editingDeposit.transferType, mas: editingDeposit.mas, remarks: editingDeposit.remarks, nonCash: editingDeposit.nonCash }
    : { date: inPeriod, bankAccount: "DSRDPI", amount: "", transferType: "", mas: "", remarks: "", nonCash: false });
  const [turnover, setTurnover] = useState(editingTurnover
    ? { date: editingTurnover.date, receivedBy: editingTurnover.bankAccount, amount: String(editingTurnover.amount), mas: editingTurnover.mas, remarks: editingTurnover.remarks }
    : { date: inPeriod, receivedBy: lastFinanceReceiver(), amount: "", mas: "", remarks: "" });
  const [fidelity, setFidelity] = useState(editingFidelity
    ? { masEmployeeId: editingFidelity.masEmployeeId, amount: String(editingFidelity.amount), date: editingFidelity.date, remarks: editingFidelity.remarks }
    : { masEmployeeId: "", amount: "", date: inPeriod, remarks: "" });
  const [cashBeg, setCashBeg] = useState({ amount: report.cash.cashBegEdit ? String(report.cash.cashBegEdit.amount) : "", reason: report.cash.cashBegEdit?.reason ?? "" });
  const [notes, setNotes] = useState({ pendingCash: String(report.notes.pendingCash || ""), specificRemarks: report.notes.specificRemarks, pendingTransactions: report.notes.pendingTransactions, otherComments: report.notes.otherComments });
  // The cash held at the start of a day, counted for Finance to confirm (lib/cash-position.ts, from December 1, 2026).
  const [count, setCount] = useState({ date: report.from >= CARRY_START ? report.from : CARRY_START, amount: "", denominations: "", note: "" });
  const masNames = report.masSummary.rows.map((row) => row.name);
  // One form at a time, in tabs (owner, October 14, 2026: the side-by-side forms were messy). Editing opens its tab.
  const [section, setSection] = useState<RecordSection>(editingTurnover ? "finance" : editing ? "deposit" : editingFidelity ? "fidelity" : "expense");
  // Remitted to Finance pressed: open the tab with the Remaining Cash on Hand as the amount (the clerk lowers it if they give less).
  const [seenFinanceRequest, setSeenFinanceRequest] = useState(financeRequest);
  const remainingText = String(Math.max(0, report.cash.remainingCashOnHand));
  if (financeRequest !== seenFinanceRequest) {
    setSeenFinanceRequest(financeRequest);
    setSection("finance");
    if (!editingTurnover) setTurnover((current) => ({ ...current, date: report.from === report.to ? report.from : report.to, amount: remainingText, receivedBy: current.receivedBy || lastFinanceReceiver() }));
  }
  const textarea = "min-h-20 w-full rounded-md border bg-background p-2 text-sm";
  const fin = finWording(report);
  /*
   * More than the cash on hand (owner, November 28, 2026): the cash on hand before this record (an edited one is put
   * back first). Over by centavos only on a whole-peso amount: Remitted whole amount saves it with the centavos added as
   * cash in, so the cash on hand ends at zero; a bigger difference is only warned about.
   */
  const remainingBefore = Math.round((report.cash.remainingCashOnHand + (editingTurnover ? editingTurnover.amount - (editingTurnover.wholeAmountAdded ?? 0) : 0)) * 100) / 100;
  const turnoverAmount = Number(turnover.amount) || 0;
  const turnoverOver = turnover.amount ? remittedOver(turnoverAmount, remainingBefore) : 0;
  const wholeAmount = canRemitWholeAmount(turnoverAmount, turnoverOver);
  async function saveTurnover(wholeAmountAdded: number) {
    const body = { date: report.from === report.to ? report.from : turnover.date, bankAccount: turnover.receivedBy, amount: turnoverAmount, transferType: FINANCE_TURNOVER, mas: turnover.mas, remarks: turnover.remarks, wholeAmountAdded };
    if (editingTurnover) { if (await act({ action: "edit-deposit", id: editingTurnover.id, ...body })) onEditDone(); return; }
    if (await act({ action: "add-deposit", ...body })) { rememberFinanceReceiver(turnover.receivedBy); setTurnover((current) => ({ ...current, amount: "", remarks: "" })); }
  }

  return (
    <div className="rounded-xl border print:hidden">
      <div className="overflow-x-auto border-b px-2"><div className="flex min-w-max gap-1" role="tablist" aria-label="Record for this report">
        {RECORD_SECTIONS.filter(([id]) => (id !== "cashBeg" || !report.cash.carries || report.cash.openingMissing) && (id !== "count" || report.to >= CARRY_START)).map(([id, label]) => [id, fin ? FIN_SECTION_LABELS[id] ?? label : label] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}
          className={`border-b-2 px-3 py-3 text-sm font-medium ${section === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
      </div></div>
      <div className="p-4">
      {section === "expense" && <form id="expense-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (editingExpense) { if (await act({ action: "edit-expense", id: editingExpense.id, ...expense, amount: Number(expense.amount), photos: photoBodies() })) onExpenseDone(); return; }
        if (await act({ action: "add-expense", ...expense, amount: Number(expense.amount), attachments: [], photos: photoBodies() })) { setExpense((current) => ({ ...current, amount: "", receiptNumber: "", payee: "", description: "", remarks: "" })); setExpensePhotos([]); }
      }}>
        <FormTitle title={editingExpense ? `Edit expense ${editingExpense.id}` : "Add expense / other cash out"} note={editingExpense ? "Saved to Expenses as well; the report and the cash on hand follow." : "Saved to Expenses for your branch. Edit or delete it from the Expenses list above."} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name / type of expense"><select className={field} value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>{EXPENSE_ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select></Field>
          {expense.category === "Others" ? <Field label="Specify the expense"><Input value={expense.categoryOther} onChange={(event) => setExpense({ ...expense, categoryOther: event.target.value })} /></Field>
            : expense.category === BURIAL_ACCOUNT ? <Field label="Member / deceased member name *"><Input maxLength={150} value={expense.payee} onChange={(event) => setExpense({ ...expense, payee: event.target.value })} /></Field>
            : <div className="hidden sm:block" />}
          <Field label="Date"><Input type="date" value={expense.date} onChange={(event) => setExpense({ ...expense, date: event.target.value })} /></Field>
          <Field label="Amount"><Input type="number" min="0" step="0.01" placeholder="0.00" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} /></Field>
          <Field label="Receipt / CV no. *"><Input value={expense.receiptNumber} onChange={(event) => setExpense({ ...expense, receiptNumber: event.target.value })} /></Field>
          <Field label="Approved by"><select className={field} value={expense.approvedBy} onChange={(event) => setExpense({ ...expense, approvedBy: event.target.value })}>{EXPENSE_APPROVERS.map((item) => <option key={item}>{item}</option>)}</select></Field>
          {expense.approvedBy === "Other" && <Field label="Who approved it" wide><Input value={expense.approvedByOther} onChange={(event) => setExpense({ ...expense, approvedByOther: event.target.value })} /></Field>}
          <Field label="Purpose *" wide><Input value={expense.description} onChange={(event) => setExpense({ ...expense, description: event.target.value })} /></Field>
          <Field label="Remarks" wide><Input value={expense.remarks} onChange={(event) => setExpense({ ...expense, remarks: event.target.value })} /></Field>
        </div>
        <ReceiptPhotosPicker photos={expensePhotos} onChange={setExpensePhotos} kind="expense" optional={savedPhotos > 0}
          title={savedPhotos ? "Add more receipt photos" : "Photo of the receipt"}
          note={savedPhotos ? `This expense has ${savedPhotos} receipt photo${savedPhotos === 1 ? "" : "s"}; photos added here are kept with them.` : "Take or choose a photo or scan of the receipt or voucher. At least one is required; add more if it has several pages."} />
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={saving || !expense.amount || !expense.description.trim() || !expense.receiptNumber.trim() || (expense.category === BURIAL_ACCOUNT && !expense.payee.trim()) || (!savedPhotos && !expensePhotos.length)}>{editingExpense ? "Save changes" : "Save expense"}</Button>{editingExpense && <Button type="button" size="sm" variant="outline" onClick={onExpenseDone}>Cancel</Button>}</div>
      </form>}

      {section === "deposit" && <form id="deposit-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (editingDeposit) { if (await act({ action: "edit-deposit", id: editingDeposit.id, ...deposit, amount: Number(deposit.amount) })) onEditDone(); return; }
        if (await act({ action: "add-deposit", ...deposit, date: report.from === report.to ? report.from : deposit.date, amount: Number(deposit.amount) })) setDeposit((current) => ({ ...current, amount: "", remarks: "" }));
      }}>
        <FormTitle title={editingDeposit ? `Edit deposit ${editingDeposit.id}` : "Add cash forwarded to bank"} note="Cash out of this report: cash you deposited or sent to the bank. Cash handed to Finance at the office goes in Cash to Finance." />
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The report's day (owner, October 23, 2026): to record a deposit on another day, open that day's report. */}
          <Field label="Date">{report.from === report.to
            ? <Input type="date" value={report.from} readOnly title="This report's day. Open another day's report to record a deposit there." />
            : <Input type="date" min={report.from} max={report.to} value={deposit.date} onChange={(event) => setDeposit({ ...deposit, date: event.target.value })} />}</Field>
          <Field label="Amount"><Input type="number" min="0" step="0.01" placeholder="0.00" value={deposit.amount} onChange={(event) => setDeposit({ ...deposit, amount: event.target.value })} /></Field>
          <Field label="Bank account name"><Input value={deposit.bankAccount} onChange={(event) => setDeposit({ ...deposit, bankAccount: event.target.value })} /></Field>
          <Field label="Type of transfer *"><Input value={deposit.transferType} onChange={(event) => setDeposit({ ...deposit, transferType: event.target.value })} placeholder="e.g. RCBC, GCash" /></Field>
          <Field label="MAS"><Input list="report-mas" value={deposit.mas} onChange={(event) => setDeposit({ ...deposit, mas: event.target.value })} /><datalist id="report-mas">{masNames.map((name) => <option key={name} value={name} />)}</datalist></Field>
          <Field label="Remarks * (with a number)"><Input value={deposit.remarks} onChange={(event) => setDeposit({ ...deposit, remarks: event.target.value })} placeholder="e.g. Ref 01101026001363" /></Field>
          {/* A bank or e-wallet payment kept for its details (owner, November 24, 2026): money already in the bank, so no cash out. */}
          {report.to >= CARRY_START && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={deposit.nonCash} onChange={(event) => setDeposit({ ...deposit, nonCash: event.target.checked })} /><span>Bank / e-wallet payment (not cash): recorded for its details only; it takes no cash out. From {showDate(CARRY_START)} bank and e-wallet payments are not counted as cash on hand.</span></label>}
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !deposit.amount || !deposit.transferType.trim() || !/\d/.test(deposit.remarks)}>{editingDeposit ? "Save changes" : "Save deposit"}</Button>
          {deposit.remarks.trim() !== "" && !/\d/.test(deposit.remarks) && <span className="self-center text-xs text-red-700 dark:text-red-400">Remarks need a number; letters only are not accepted.</span>}
          {editingDeposit && <Button type="button" size="sm" variant="outline" onClick={onEditDone}>Cancel</Button>}
        </div>
      </form>}

      {/* Cash handed to Finance at the office in person (owner, November 24, 2026): out of the cash on hand like a deposit. */}
      {section === "finance" && <form id="finance-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (wholeAmount) return;
        await saveTurnover(0);
      }}>
        <FormTitle title={editingTurnover ? `Edit cash turned over to Finance ${editingTurnover.id}` : "Add cash turned over to Finance"} note="Cash out of this report: cash you handed to Finance at the office in person. Record each handover on the day you gave it. What you keep is carried to the next day; no Cash Beg to type." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">{report.from === report.to
            ? <Input type="date" value={report.from} readOnly title="This report's day. Open another day's report to record a handover there." />
            : <Input type="date" min={report.from} max={report.to} value={turnover.date} onChange={(event) => setTurnover({ ...turnover, date: event.target.value })} />}</Field>
          <Field label="Amount"><Input type="number" min="0" step="0.01" placeholder="0.00" value={turnover.amount} onChange={(event) => setTurnover({ ...turnover, amount: event.target.value })} />
            {!editingTurnover && report.cash.remainingCashOnHand > 0 && turnover.amount !== remainingText && <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setTurnover({ ...turnover, amount: remainingText })}>Use {fin ? "Ending cash on hand" : "Remaining Cash on Hand"} ({money(report.cash.remainingCashOnHand)})</button>}</Field>
          <Field label="Received by (Finance) *"><Input value={turnover.receivedBy} onChange={(event) => setTurnover({ ...turnover, receivedBy: event.target.value })} placeholder="Who in Finance received the cash" /></Field>
          <Field label="MAS"><Input list="report-mas" value={turnover.mas} onChange={(event) => setTurnover({ ...turnover, mas: event.target.value })} /></Field>
          <Field label="Remarks" wide><Input value={turnover.remarks} onChange={(event) => setTurnover({ ...turnover, remarks: event.target.value })} placeholder="e.g. Nov 23 collections, acknowledgement no." /></Field>
        </div>
        {turnoverOver > 0 && (wholeAmount
          ? <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <p><strong>{money(turnoverAmount)} is {money(turnoverOver)} more than your {fin ? "ending cash on hand" : "Remaining Cash on Hand"} ({money(remainingBefore)}).</strong> If you rounded up and handed Finance the whole amount, press <strong>Remitted whole amount</strong>: the {money(turnoverOver)} is recorded as added, so your cash on hand ends at {money(0)}. Otherwise type {money(remainingBefore)}.</p>
              <Button type="button" size="sm" disabled={saving || !turnover.receivedBy.trim()} onClick={() => void saveTurnover(turnoverOver)}>Remitted whole amount (+{money(turnoverOver)})</Button>
            </div>
          : <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><strong>{money(turnoverAmount)} is {money(turnoverOver)} more than your {fin ? "ending cash on hand" : "Remaining Cash on Hand"} ({money(remainingBefore)}).</strong> Your cash on hand would go below zero. Check the amount, and your entries, expenses and deposits on this report, before saving.</p>)}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !turnover.amount || !turnover.receivedBy.trim() || wholeAmount}>{editingTurnover ? "Save changes" : "Save cash to Finance"}</Button>
          {editingTurnover && <Button type="button" size="sm" variant="outline" onClick={onEditDone}>Cancel</Button>}
        </div>
      </form>}

      {/* The cash held at the start of a day (owner, November 24, 2026): Finance confirms it, then the report carries from it. */}
      {section === "count" && <form id="count-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (await act({ action: "add-cash-count", date: count.date, amount: Number(count.amount), denominations: count.denominations, note: count.note })) setCount((current) => ({ ...current, amount: "", denominations: "", note: "" }));
      }}>
        <FormTitle title="Record a cash count" note={`Count the cash you hold for ${report.branch} before the day's transactions, and record it. Once Finance confirms it (Remittances → Cash counts), every report from that day starts with the cash carried from it. Record the first one on ${showDate(CARRY_START)}, and again whenever the cash is counted.`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start of day"><Input type="date" min={CARRY_START} value={count.date} onChange={(event) => setCount({ ...count, date: event.target.value })} /></Field>
          <Field label="Cash counted"><Input type="number" min="0" step="0.01" placeholder="0.00" value={count.amount} onChange={(event) => setCount({ ...count, amount: event.target.value })} /></Field>
          <Field label="By denomination (optional)"><Input value={count.denominations} onChange={(event) => setCount({ ...count, denominations: event.target.value })} placeholder="e.g. 1000x3, 500x1, 20x2" /></Field>
          <Field label="Note"><Input value={count.note} onChange={(event) => setCount({ ...count, note: event.target.value })} placeholder="e.g. counted with the branch head" /></Field>
        </div>
        <Button type="submit" size="sm" disabled={saving || count.amount === "" || count.date < CARRY_START}>Record cash count</Button>
        {cashCounts.length > 0 && <div className="overflow-x-auto rounded-md border"><table className="w-full text-xs">
          <thead className="bg-muted/50 text-left"><tr>{["Start of", "Branch", "Counted", "Status", "Finance"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead>
          <tbody>{cashCounts.map((item) => <tr key={item.id} className="border-t"><td className="p-2">{showDate(item.date)}</td><td className="p-2">{item.branch}</td><td className="p-2">{money(item.amount)}</td>
            <td className="p-2">{item.status === "Pending" ? "Waiting for Finance" : item.status}</td><td className="p-2">{item.decidedBy}{item.decisionNote ? `: ${item.decisionNote}` : ""}</td></tr>)}</tbody>
        </table></div>}
      </form>}

      {/* Fidelity handed in after the MAS's entries were encoded: its own slip, approved in Remittances (October 13, 2026). */}
      {section === "fidelity" && <form id="fidelity-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        const body = { ...fidelity, amount: Number(fidelity.amount) };
        if (editingFidelity) { if (await act({ action: "edit-fidelity", id: editingFidelity.id, ...body })) onFidelityDone(); return; }
        if (await act({ action: "add-fidelity", ...body })) setFidelity((current) => ({ ...current, masEmployeeId: "", amount: "", remarks: "" }));
      }}>
        <FormTitle title={editingFidelity ? `Edit Fidelity ${editingFidelity.id}` : "Add Fidelity (handed in after encoding)"} note="Counts as cash in (Fidelity Bond) on this report at once, and in the MAS's Fidelity once approved in Remittances. Edit or void it until then." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="MAS *" wide><select className={field} value={fidelity.masEmployeeId} onChange={(event) => setFidelity({ ...fidelity, masEmployeeId: event.target.value })}>
            <option value="">Choose the MAS</option>{masChoices.map((mas) => <option key={mas.id} value={mas.id}>{mas.name}</option>)}
          </select></Field>
          <Field label="Date received"><Input type="date" max={manilaToday()} value={fidelity.date} onChange={(event) => setFidelity({ ...fidelity, date: event.target.value })} /></Field>
          <Field label="Amount *"><Input type="number" min="0" step="0.01" placeholder="0.00" value={fidelity.amount} onChange={(event) => setFidelity({ ...fidelity, amount: event.target.value })} /></Field>
          <Field label="Remarks" wide><Input maxLength={300} placeholder="e.g. Fidelity for the Oct 12 collections" value={fidelity.remarks} onChange={(event) => setFidelity({ ...fidelity, remarks: event.target.value })} /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !fidelity.masEmployeeId || !(Number(fidelity.amount) > 0)}>{editingFidelity ? "Save changes" : "Save Fidelity"}</Button>
          {editingFidelity && <Button type="button" size="sm" variant="outline" onClick={onFidelityDone}>Cancel</Button>}
        </div>
      </form>}

      {/* Cash Beg is the cash received (owner, October 13, 2026): the clerk types it, with the reason; blank = zero. */}
      {section === "cashBeg" && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act({ action: "save-cash-beg", cashBeg: cashBeg.amount === "" ? "" : Number(cashBeg.amount), reason: cashBeg.reason }); }}>
        <FormTitle title={fin ? "Opening cash balance for this report" : "Cash Beg for this report"} note={fin ? "The cash you actually held at the start of this report. It applies to this report only; left blank, the opening balance is zero." : "The cash you actually received at the start of this report. It applies to this report only; left blank, Cash Beg is zero."} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={fin ? "Opening cash balance" : "Cash received (Cash Beg)"}><Input type="number" min="0" step="0.01" placeholder="0.00" value={cashBeg.amount} onChange={(event) => setCashBeg({ ...cashBeg, amount: event.target.value })} /></Field>
          {cashBeg.amount !== "" ? <Field label="Reason *"><Input maxLength={300} placeholder="e.g. Counted cash on hand" value={cashBeg.reason} onChange={(event) => setCashBeg({ ...cashBeg, reason: event.target.value })} /></Field> : <div className="hidden sm:block" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving || cashBeg.amount !== "" && cashBeg.reason.trim().length < 5}>Save Cash Beg</Button>
          {report.cash.cashBegEdit && <Button type="button" size="sm" variant="outline" onClick={() => { setCashBeg({ amount: "", reason: "" }); void act({ action: "save-cash-beg", cashBeg: "" }); }}>Clear</Button>}
          {report.cash.cashBegEdit?.updatedAt && <span className="text-xs text-muted-foreground">Saved {new Date(report.cash.cashBegEdit.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {report.cash.cashBegEdit.updatedBy}</span>}
        </div>
      </form>}

      {section === "notes" && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act({ action: "save-notes", ...notes, pendingCash: Number(notes.pendingCash) || 0 }); }}>
        <FormTitle title="Notes for this report" note="Shown in the report's remark boxes, and to reviewers and auditors." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={fin ? "Cash received, not yet recorded" : "Pending cash, to be encoded"}><Input type="number" min="0" step="0.01" placeholder="0.00" value={notes.pendingCash} onChange={(event) => setNotes({ ...notes, pendingCash: event.target.value })} /></Field>
          <div className="hidden sm:block" />
          <Field label={fin ? "Remarks" : "Specific remarks"} wide><textarea className={textarea} value={notes.specificRemarks} onChange={(event) => setNotes({ ...notes, specificRemarks: event.target.value })} /></Field>
          <Field label={fin ? "Open items" : "Pending transactions"}><textarea className={textarea} value={notes.pendingTransactions} onChange={(event) => setNotes({ ...notes, pendingTransactions: event.target.value })} /></Field>
          <Field label={fin ? "Other notes" : "Other comments / remarks"}><textarea className={textarea} value={notes.otherComments} onChange={(event) => setNotes({ ...notes, otherComments: event.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Save notes"}</Button>
          {report.notes.updatedAt && <span className="text-xs text-muted-foreground">Last saved {new Date(report.notes.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {report.notes.updatedBy}</span>}
        </div>
      </form>}
      {saved && <p role={saved.ok ? "status" : "alert"} className={`mt-4 rounded-lg border px-3 py-2 text-sm ${saved.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200"}`}>{saved.text}</p>}
      </div>
    </div>
  );
}

/** The record tabs in finance wording, from December 1, 2026 (finWording). */
const FIN_SECTION_LABELS: Partial<Record<RecordSection, string>> = { expense: "Expenses", deposit: "Bank deposit", finance: "Remitted to Finance", cashBeg: "Opening balance" };
const RECORD_SECTIONS = [["expense", "Expense"], ["deposit", "Cash to bank"], ["finance", "Cash to Finance"], ["fidelity", "Fidelity"], ["count", "Cash count"], ["cashBeg", "Cash Beg"], ["notes", "Notes"]] as const;
type RecordSection = (typeof RECORD_SECTIONS)[number][0];

/** A form's heading and what it is for. */
// Who in Finance received the clerk's cash last time, kept in this browser only as a convenience (may be unavailable).
const FINANCE_RECEIVER_KEY = "clerk-report:finance-received-by";
function lastFinanceReceiver() {
  try { return typeof window === "undefined" ? "" : window.localStorage.getItem(FINANCE_RECEIVER_KEY) ?? ""; } catch { return ""; }
}
function rememberFinanceReceiver(name: string) {
  try { if (name.trim()) window.localStorage.setItem(FINANCE_RECEIVER_KEY, name.trim()); } catch { /* storage blocked: nothing to remember */ }
}

function FormTitle({ title, note }: { title: string; note: string }) {
  return <div><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{note}</p></div>;
}

/** A label above its input; `wide` spans both columns. */
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block space-y-1 ${wide ? "sm:col-span-2" : ""}`}><span className="block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
