"use client";

import { AlertTriangle, ChevronDown, Eye, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { EntryDetails } from "@/components/entry-details";
import { ReceiptPhotoView } from "@/components/receipt-photo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClerkReport as Report, ReportLine } from "@/lib/clerk-report";
import { BURIAL_ACCOUNT, EXPENSE_ACCOUNTS, EXPENSE_APPROVERS } from "@/lib/expense-options";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Kind = "daily" | "weekly" | "monthly" | "yearly";
type Remark = { id: string; comment: string; createdAt: string; encodedBy: string };
type Result = { success: boolean; message?: string; report: Report; remarks: Remark[]; canChoose: boolean; isOwn: boolean; branch: string; branchChoices: string[]; masChoices: Array<{ id: string; name: string }>; clerks: Array<{ employeeId: string; name: string; branch: string }> };

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
export function ClerkReport({ kind, review = false, employeeId: fixedEmployee, date: fixedDate, branch: sharedBranch, onBranchChange, hideEmptyBranches = false }: { kind: Kind; review?: boolean; employeeId?: string; date?: string; branch?: string; onBranchChange?: (branch: string) => void; hideEmptyBranches?: boolean }) {
  const [date, setDate] = useState(fixedDate ?? todayInManila());
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  // Reports are per branch (owner, October 13, 2026): "" = the clerk's primary branch, "all" = every branch (Audits).
  // The tabs share the choice through `branch` / `onBranchChange`.
  const [ownBranch, setOwnBranch] = useState("");
  const branch = sharedBranch ?? ownBranch;
  const setBranch = onBranchChange ?? setOwnBranch;
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showEntries, setShowEntries] = useState(review);
  const [open, setOpen] = useState("");
  const [remark, setRemark] = useState("");
  // A deposit opened for editing in the record panel (owner, October 13, 2026: edit it, or void it).
  const [editingDeposit, setEditingDeposit] = useState<Report["deposits"][number] | null>(null);
  // An expense opened for editing (owner, October 16, 2026: edit or delete expenses on the report, as deposits).
  const [editingExpense, setEditingExpense] = useState<Report["expenses"][number] | null>(null);
  // A Fidelity entry (handed in after encoding) opened for editing (October 13, 2026).
  const [editingFidelity, setEditingFidelity] = useState<Report["fidelitySlips"][number] | null>(null);
  // Every entry filters (owner, October 14, 2026): kind, remitted / returned / missing photo, OR search, MAS, program.
  const [entryFilter, setEntryFilter] = useState<EntryFilter>(NO_FILTER);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, date, ...(employeeId ? { employeeId } : {}), ...(branch ? { branch } : {}) });
      const response = await fetch(`/api/clerk-report?${params}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to build the report.");
      setData(result);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to build the report.");
    } finally {
      setLoading(false);
    }
  }, [kind, date, employeeId, branch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the period or clerk changes
    void load();
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["sales", "collections", "remittances", "remittance_collections", "expenses", "cash_transactions", "bank_deposits", "daily_audits", "report_remarks", "report_notes"], load, 10000);

  /** Sends one of the clerk's own report actions, then reloads the report. */
  const act = async (body: Record<string, unknown>) => {
    setMessage("");
    const response = await fetch("/api/clerk-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, date, branch: data?.branch === "all" ? "" : data?.branch ?? "", ...body }) });
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
  const entries = report ? filterEntries(report.entries, entryFilter) : [];
  const filtering = JSON.stringify(entryFilter) !== JSON.stringify(NO_FILTER);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">Period
          <Input className="mt-1 w-44" type={inputType(kind)} min={kind === "yearly" ? 2000 : undefined} max={kind === "yearly" ? 2100 : undefined} value={toInput(kind, date)} disabled={Boolean(fixedDate)} onChange={(event) => event.target.value && setDate(fromInput(kind, event.target.value))} />
        </label>
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

      {report && (
        <div className="clerk-report-sheet rounded-xl border bg-card p-3 text-[13px] text-card-foreground print:border-0 print:p-0">
          {/* Fits the screen, no sideways scroll (owner, October 13, 2026): sections stack on narrow screens; print keeps the paper layout. */}
          <div className="min-w-0 space-y-3">
            <ReportHeader report={report} />

            <div className="grid gap-3 xl:grid-cols-2 print:grid-cols-2">
              <EntryTable title="New Sales Section" color={tone.sales} groupLabel={report.groupLabel} rows={report.newSales.rows} total={report.newSales.total} />
              <EntryTable title="Collections Section" color={tone.collections} groupLabel={report.groupLabel} rows={report.collection.rows} total={report.collection.total} />
            </div>

            <div className="grid gap-3 xl:grid-cols-2 print:grid-cols-2">
              <Grid title="Expenses/Other Cash Out Section" color={tone.expenses}
                headers={["Account Name/Type of Expense", report.whenLabel, "Amount", "Receipt/CV", "Purpose", "Rmks"]}
                rows={report.expenses.map((item) => [item.account === BURIAL_ACCOUNT && item.payee ? `${item.account}: ${item.payee}` : item.account, item.when, money(item.amount), item.receipt, item.purpose, item.remarks])}
                total={report.expenseTotal}
                action={own ? (index) => <span className="flex gap-2 print:hidden"><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingExpense(report.expenses[index]); setTimeout(() => document.getElementById("expense-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={() => { const reason = window.prompt("Why is this expense being deleted?"); if (reason) void act({ action: "delete-expense", id: report.expenses[index].id, reason }); }}>Delete</button></span> : undefined} />
              <Grid title="Cash Flow Transaction and Other Cash Ins" color={tone.cashFlow}
                headers={["Bank Account Name", report.whenLabel, "Amount", "Type of Transfer", "MAS", "Rmks"]}
                rows={report.cashFlowTotals
                  // Monthly and yearly: the total of each week / month (owner, October 20, 2026); deposits are edited on the daily or weekly report.
                  ? report.cashFlowTotals.map((item) => [item.bankAccount, item.when, money(item.amount), item.transferType, item.mas, `${item.count} deposit${item.count === 1 ? "" : "s"}`])
                  : report.deposits.map((item) => [item.bankAccount, item.when, money(item.amount), item.transferType, item.mas, item.remarks])}
                total={report.depositTotal}
                action={own && !report.cashFlowTotals ? (index) => <span className="flex gap-2 print:hidden"><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingDeposit(report.deposits[index]); setTimeout(() => document.getElementById("deposit-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={() => { const reason = window.prompt("Why is this deposit being voided?"); if (reason) void act({ action: "void-deposit", id: report.deposits[index].id, reason }); }}>Void</button></span> : undefined} />
            </div>

            {(report.fidelityReceived.length > 0 || own) && (
              // Every Fidelity received: with a batch, or handed in after encoding; the total is the Fidelity Bond line.
              <Grid title="Fidelity received" color={tone.cashFlow}
                headers={["MAS", report.whenLabel, "Amount", "Status", "Rmks", "Ref"]}
                rows={report.fidelityReceived.map((item) => [item.masName, item.when, money(item.amount), item.status, item.remarks, item.id])}
                total={report.cash.fidelity}
                action={own ? (index) => { const item = report.fidelitySlips.find((slip) => slip.id === report.fidelityReceived[index].id); return item && ["Pending Approval", "Discrepancy"].includes(item.status) ? <span className="flex gap-2 print:hidden"><button type="button" className="text-xs text-primary underline" onClick={() => { setEditingFidelity(item); setTimeout(() => document.getElementById("fidelity-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Edit</button><button type="button" className="text-xs text-red-700 underline" onClick={() => { const reason = window.prompt("Why is this Fidelity entry being voided?"); if (reason) void act({ action: "void-fidelity", id: item.id, reason }); }}>Void</button></span> : null; } : undefined} />
            )}

            <div className="grid gap-3 lg:grid-cols-[1.1fr_0.8fr_1.6fr] print:grid-cols-[1.1fr_0.8fr_1.6fr]">
              <dl className="space-y-0.5">
                <Cash label="Cash Beg/Pending COH" value={report.cash.cashBeg} color={tone.cashBeg} />
                {report.cash.cashBegEdit && <p className="text-right text-[11px] text-muted-foreground">Typed by {report.cash.cashBegEdit.updatedBy}: {report.cash.cashBegEdit.reason}</p>}
                <Cash label="Sales Net" value={report.cash.salesNet} />
                <Cash label="Collection Net" value={report.cash.collectionNet} />
                <Cash label="Fidelity Bond" value={report.cash.fidelity} />
                <Cash label="Penalty" value={report.cash.penalty} />
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

      {report && own && data?.branch !== "all" && <RecordPanel key={`${report.kind}-${report.from}-${report.branch}-${editingDeposit?.id ?? ""}-${editingFidelity?.id ?? ""}-${editingExpense?.id ?? ""}`} report={report} act={act} editing={editingDeposit} onEditDone={() => setEditingDeposit(null)}
        editingExpense={editingExpense} onExpenseDone={() => setEditingExpense(null)}
        masChoices={data?.masChoices ?? []} editingFidelity={editingFidelity} onFidelityDone={() => setEditingFidelity(null)} />}
      {report && own && data?.branch === "all" && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm print:hidden">Choose one branch to record expenses, deposits, Cash Beg and notes for it.</p>}

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
                    <span className="block text-xs text-muted-foreground">OR / app date {entry.orDate || "—"} · remitted {entry.dateRemitted || "—"}</span>
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
          {data.remarks.map((item) => <p key={item.id} className="text-sm"><span className="text-muted-foreground">{item.createdAt.slice(0, 16).replace("T", " ")} · {item.encodedBy}:</span> {item.comment}</p>)}
          {!data.remarks.length && <p className="text-sm text-muted-foreground">No remarks yet.</p>}
          <div className="flex gap-2"><Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Add a remark for this clerk's report" /><Button type="button" disabled={!remark.trim()} onClick={() => void saveRemark()}>Save</Button></div>
        </div>
      )}
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

function EntryTable({ title, color, groupLabel, rows, total }: { title: string; color: string; groupLabel: string; rows: ReportLine[]; total: ReportLine }) {
  const cells = (line: ReportLine) => [String(line.accounts || "-"), money(line.gross), money(line.incentives), money(line.net), money(line.fidelity), money(line.penalty)];
  const filler = Math.max(0, 5 - rows.length);
  return (
    <table className="w-full border-collapse border text-[12px]">
      <thead>
        <tr><th colSpan={7} className={`p-1 text-center font-bold ${color}`}>{title}</th></tr>
        <tr className="border-b">{[groupLabel, "Accts", "Gross", "Inc", "Net", "Fid/ bond", "Penalty"].map((header, index) => <th key={header} className={`border-r p-1 font-semibold ${index ? "text-right" : "text-left"} ${index === 5 ? "text-[10px] italic" : ""}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((line) => <tr key={line.label} className="border-b"><td className="break-words border-r p-1 font-medium">{line.label}</td>{cells(line).map((value, index) => <td key={index} className="border-r p-1 text-right tabular-nums">{value}</td>)}</tr>)}
        {Array.from({ length: filler }, (_, index) => <tr key={`filler-${index}`} className="h-6 border-b">{Array.from({ length: 7 }, (__, cell) => <td key={cell} className="border-r" />)}</tr>)}
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
        {rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b">{row.map((value, index) => <td key={index} className={`break-words border-r p-1 ${index === 2 ? "text-right tabular-nums" : "text-center"}`}>{value}{index === 5 && action?.(rowIndex)}</td>)}</tr>)}
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
            <tr><th rowSpan={2} className="border p-1">No.</th><th rowSpan={2} className="border p-1">Marketing Account Staff</th><th colSpan={3} className="border bg-orange-200 p-1 text-orange-950">NEW SALES</th><th colSpan={3} className="border bg-blue-200 p-1 text-blue-950">COLLECTION</th><th colSpan={3} className="border bg-green-200 p-1 text-green-950">CVE (%)</th></tr>
            <tr>{["ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "INC.", "ACCTS", "GROSS", "CVE%"].map((header, index) => <th key={`${header}-${index}`} className="border p-1 text-[11px]">{header}</th>)}</tr>
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
/** The form values of a saved expense: "Other: X" splits into Other and its detail. */
function expenseForm(item: Report["expenses"][number]) {
  const split = (value: string, options: readonly string[], fallback: string) => options.includes(value) ? { choice: value, other: "" }
    : value.startsWith("Other: ") ? { choice: "Other", other: value.slice(7) } : value ? { choice: "Other", other: value } : { choice: fallback, other: "" };
  const account = split(item.account, EXPENSE_ACCOUNTS, "Transportation"), approver = split(item.approvedBy, EXPENSE_APPROVERS, "VP Finance");
  return { category: account.choice, categoryOther: account.other, date: item.date, amount: String(item.amount), receiptNumber: item.receipt, payee: item.payee, description: item.purpose, remarks: item.remarks, approvedBy: approver.choice, approvedByOther: approver.other };
}

function RecordPanel({ report, act, editing, onEditDone, masChoices, editingFidelity, onFidelityDone, editingExpense, onExpenseDone }: { report: Report; act: (body: Record<string, unknown>) => Promise<boolean>; editing: Report["deposits"][number] | null; onEditDone: () => void;
  editingExpense: Report["expenses"][number] | null; onExpenseDone: () => void;
  masChoices: Array<{ id: string; name: string }>; editingFidelity: Report["fidelitySlips"][number] | null; onFidelityDone: () => void }) {
  const today = todayInManila();
  const inPeriod = today >= report.from && today <= report.to ? today : report.to;
  const [expense, setExpense] = useState(editingExpense ? expenseForm(editingExpense) : { category: "Transportation", categoryOther: "", date: inPeriod, amount: "", receiptNumber: "", payee: "", description: "", remarks: "", approvedBy: "VP Finance", approvedByOther: "" });
  const [deposit, setDeposit] = useState(editing
    ? { date: editing.date, bankAccount: editing.bankAccount, amount: String(editing.amount), transferType: editing.transferType, mas: editing.mas, remarks: editing.remarks }
    : { date: inPeriod, bankAccount: "DSRDPI", amount: "", transferType: "", mas: "", remarks: "" });
  const [fidelity, setFidelity] = useState(editingFidelity
    ? { masEmployeeId: editingFidelity.masEmployeeId, amount: String(editingFidelity.amount), date: editingFidelity.date, remarks: editingFidelity.remarks }
    : { masEmployeeId: "", amount: "", date: inPeriod, remarks: "" });
  const [cashBeg, setCashBeg] = useState({ amount: report.cash.cashBegEdit ? String(report.cash.cashBegEdit.amount) : "", reason: report.cash.cashBegEdit?.reason ?? "" });
  const [notes, setNotes] = useState({ pendingCash: String(report.notes.pendingCash || ""), specificRemarks: report.notes.specificRemarks, pendingTransactions: report.notes.pendingTransactions, otherComments: report.notes.otherComments });
  const masNames = report.masSummary.rows.map((row) => row.name);
  // One form at a time, in tabs (owner, October 14, 2026: the side-by-side forms were messy). Editing opens its tab.
  const [section, setSection] = useState<RecordSection>(editing ? "deposit" : editingFidelity ? "fidelity" : "expense");
  const textarea = "min-h-20 w-full rounded-md border bg-background p-2 text-sm";

  return (
    <div className="rounded-xl border print:hidden">
      <div className="overflow-x-auto border-b px-2"><div className="flex min-w-max gap-1" role="tablist" aria-label="Record for this report">
        {RECORD_SECTIONS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}
          className={`border-b-2 px-3 py-3 text-sm font-medium ${section === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
      </div></div>
      <div className="p-4">
      {section === "expense" && <form id="expense-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (editingExpense) { if (await act({ action: "edit-expense", id: editingExpense.id, ...expense, amount: Number(expense.amount) })) onExpenseDone(); return; }
        if (await act({ action: "add-expense", ...expense, amount: Number(expense.amount), attachments: [] })) setExpense((current) => ({ ...current, amount: "", receiptNumber: "", payee: "", description: "", remarks: "" }));
      }}>
        <FormTitle title={editingExpense ? `Edit expense ${editingExpense.id}` : "Add expense / other cash out"} note={editingExpense ? "Saved to Expenses as well; the report and the cash on hand follow." : "Saved to Expenses for your branch. Edit or delete it from the Expenses list above."} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name / type of expense"><select className={field} value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>{EXPENSE_ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select></Field>
          {expense.category === "Other" ? <Field label="Specify the expense"><Input value={expense.categoryOther} onChange={(event) => setExpense({ ...expense, categoryOther: event.target.value })} /></Field>
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
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={!expense.amount || !expense.description.trim() || !expense.receiptNumber.trim() || (expense.category === BURIAL_ACCOUNT && !expense.payee.trim())}>{editingExpense ? "Save changes" : "Save expense"}</Button>{editingExpense && <Button type="button" size="sm" variant="outline" onClick={onExpenseDone}>Cancel</Button>}</div>
      </form>}

      {section === "deposit" && <form id="deposit-form" className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (editing) { if (await act({ action: "edit-deposit", id: editing.id, ...deposit, amount: Number(deposit.amount) })) onEditDone(); return; }
        if (await act({ action: "add-deposit", ...deposit, amount: Number(deposit.amount) })) setDeposit((current) => ({ ...current, amount: "", remarks: "" }));
      }}>
        <FormTitle title={editing ? `Edit deposit ${editing.id}` : "Add cash forwarded to bank"} note="Cash out of this report: cash you deposited or sent to the bank." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={deposit.date} onChange={(event) => setDeposit({ ...deposit, date: event.target.value })} /></Field>
          <Field label="Amount"><Input type="number" min="0" step="0.01" placeholder="0.00" value={deposit.amount} onChange={(event) => setDeposit({ ...deposit, amount: event.target.value })} /></Field>
          <Field label="Bank account name"><Input value={deposit.bankAccount} onChange={(event) => setDeposit({ ...deposit, bankAccount: event.target.value })} /></Field>
          <Field label="Type of transfer *"><Input value={deposit.transferType} onChange={(event) => setDeposit({ ...deposit, transferType: event.target.value })} placeholder="e.g. RCBC, GCash" /></Field>
          <Field label="MAS"><Input list="report-mas" value={deposit.mas} onChange={(event) => setDeposit({ ...deposit, mas: event.target.value })} /><datalist id="report-mas">{masNames.map((name) => <option key={name} value={name} />)}</datalist></Field>
          <Field label="Remarks * (with a number)"><Input value={deposit.remarks} onChange={(event) => setDeposit({ ...deposit, remarks: event.target.value })} placeholder="e.g. Ref 01101026001363" /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!deposit.amount || !deposit.transferType.trim() || !/\d/.test(deposit.remarks)}>{editing ? "Save changes" : "Save deposit"}</Button>
          {deposit.remarks.trim() !== "" && !/\d/.test(deposit.remarks) && <span className="self-center text-xs text-red-700 dark:text-red-400">Remarks need a number; letters only are not accepted.</span>}
          {editing && <Button type="button" size="sm" variant="outline" onClick={onEditDone}>Cancel</Button>}
        </div>
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
          <Field label="Date received"><Input type="date" max={todayInManila()} value={fidelity.date} onChange={(event) => setFidelity({ ...fidelity, date: event.target.value })} /></Field>
          <Field label="Amount *"><Input type="number" min="0" step="0.01" placeholder="0.00" value={fidelity.amount} onChange={(event) => setFidelity({ ...fidelity, amount: event.target.value })} /></Field>
          <Field label="Remarks" wide><Input maxLength={300} placeholder="e.g. Fidelity for the Oct 12 collections" value={fidelity.remarks} onChange={(event) => setFidelity({ ...fidelity, remarks: event.target.value })} /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!fidelity.masEmployeeId || !(Number(fidelity.amount) > 0)}>{editingFidelity ? "Save changes" : "Save Fidelity"}</Button>
          {editingFidelity && <Button type="button" size="sm" variant="outline" onClick={onFidelityDone}>Cancel</Button>}
        </div>
      </form>}

      {/* Cash Beg is the cash received (owner, October 13, 2026): the clerk types it, with the reason; blank = zero. */}
      {section === "cashBeg" && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act({ action: "save-cash-beg", cashBeg: cashBeg.amount === "" ? "" : Number(cashBeg.amount), reason: cashBeg.reason }); }}>
        <FormTitle title="Cash Beg for this report" note="The cash you actually received at the start of this report. It applies to this report only; left blank, Cash Beg is zero." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cash received (Cash Beg)"><Input type="number" min="0" step="0.01" placeholder="0.00" value={cashBeg.amount} onChange={(event) => setCashBeg({ ...cashBeg, amount: event.target.value })} /></Field>
          {cashBeg.amount !== "" ? <Field label="Reason *"><Input maxLength={300} placeholder="e.g. Counted cash on hand" value={cashBeg.reason} onChange={(event) => setCashBeg({ ...cashBeg, reason: event.target.value })} /></Field> : <div className="hidden sm:block" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={cashBeg.amount !== "" && cashBeg.reason.trim().length < 5}>Save Cash Beg</Button>
          {report.cash.cashBegEdit && <Button type="button" size="sm" variant="outline" onClick={() => { setCashBeg({ amount: "", reason: "" }); void act({ action: "save-cash-beg", cashBeg: "" }); }}>Clear</Button>}
          {report.cash.cashBegEdit?.updatedAt && <span className="text-xs text-muted-foreground">Saved {new Date(report.cash.cashBegEdit.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {report.cash.cashBegEdit.updatedBy}</span>}
        </div>
      </form>}

      {section === "notes" && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act({ action: "save-notes", ...notes, pendingCash: Number(notes.pendingCash) || 0 }); }}>
        <FormTitle title="Notes for this report" note="Shown in the report's remark boxes, and to reviewers and auditors." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pending cash, to be encoded"><Input type="number" min="0" step="0.01" placeholder="0.00" value={notes.pendingCash} onChange={(event) => setNotes({ ...notes, pendingCash: event.target.value })} /></Field>
          <div className="hidden sm:block" />
          <Field label="Specific remarks" wide><textarea className={textarea} value={notes.specificRemarks} onChange={(event) => setNotes({ ...notes, specificRemarks: event.target.value })} /></Field>
          <Field label="Pending transactions"><textarea className={textarea} value={notes.pendingTransactions} onChange={(event) => setNotes({ ...notes, pendingTransactions: event.target.value })} /></Field>
          <Field label="Other comments / remarks"><textarea className={textarea} value={notes.otherComments} onChange={(event) => setNotes({ ...notes, otherComments: event.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">Save notes</Button>
          {report.notes.updatedAt && <span className="text-xs text-muted-foreground">Last saved {new Date(report.notes.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {report.notes.updatedBy}</span>}
        </div>
      </form>}
      </div>
    </div>
  );
}

const RECORD_SECTIONS = [["expense", "Expense"], ["deposit", "Cash to bank"], ["fidelity", "Fidelity"], ["cashBeg", "Cash Beg"], ["notes", "Notes"]] as const;
type RecordSection = (typeof RECORD_SECTIONS)[number][0];

/** A form's heading and what it is for. */
function FormTitle({ title, note }: { title: string; note: string }) {
  return <div><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{note}</p></div>;
}

/** A label above its input; `wide` spans both columns. */
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block space-y-1 ${wide ? "sm:col-span-2" : ""}`}><span className="block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
