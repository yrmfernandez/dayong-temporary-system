"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Minus, Plus, Search, Trash2, X } from "lucide-react";

import { confirmDialog } from "@/components/app-dialog";
import { mamStatusClass } from "@/components/mam-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime, formatMonth } from "@/lib/date-format";
import { masCollectionQuote, MAX_SUBMISSION_MONTHS } from "@/lib/mas-collection-quote";
import { formatDeadline, incentiveDeadline, manilaNow } from "@/lib/remittance-deadline";
import type { IncentiveTier } from "@/lib/remittance";
import { useFormDraft } from "@/lib/use-form-draft";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useDeclaredNonWorkingDays } from "@/lib/use-work-calendar";

/**
 * Submit Collections (owner, October 31, 2026): a MAS, on their phone, picks the members who paid them and how many
 * months each paid. The OR date is the day the member is added; the months, NOP, amount, their incentive and what to
 * remit are worked out at once (lib/mas-collection-quote.ts). A suspended account needs Waiver ticked. Once submitted the
 * MAS cannot change or withdraw it (owner, October 31, 2026): the Entry Clerk of the branch corrects it, types the OR
 * numbers and saves it when the cash is received at Clearing, or rejects it (lib/collection-submissions.ts).
 */
type Account = {
  id: string; memberId: string; memberNumber: string; memberName: string; programId: string; programName: string; branchId: string; branch: string;
  basePay: number; flexible: boolean; maxMonthlyPayment: number | null; tiers: IncentiveTier[]; pendingIn: string;
  status: string; temporarilySuspended: boolean; suspendedAt: string; forfeitedAt: string; nextMonth: string; nextNop: number;
  lastCoveredMonth: string; unpaidMonths: number; latestOrDate: string; blocked: string;
};
type Entry = { enrollmentId: string; memberName: string; programName: string; months: number; monthFrom: string; monthTo: string; nopFrom: number; nopTo: number; amount: number; incentive: number; remittance: number; orDate: string; waiver: boolean };
type Submission = {
  id: string; branchId: string; branch: string; status: "Submitted" | "Remitted" | "Rejected" | "Saved"; entries: Entry[]; entryCount: number; totalAmount: number; totalIncentive: number;
  submittedAt: string; returnReason: string; reviewedByName: string; incentiveDeadline: string; remittedAt: string; remittedByName: string;
};
type Profile = { employeeId: string; name: string; branches: Array<{ id: string; name: string }> };
/** One member in the batch being filled: what the MAS chose. */
type BatchItem = { enrollmentId: string; months: number; waiver: boolean };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const cents = (value: number) => Math.round(value * 100) / 100;
const monthsText = (from: string, to: string) => from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export default function MasCollectionsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const offDays = useDeclaredNonWorkingDays();
  const today = manilaNow().date;

  // The unfinished batch survives leaving the page (lib/use-form-draft.ts).
  useFormDraft("mas-collections", { branchId, batch }, (draft) => {
    setBranchId(draft.branchId ?? "");
    setBatch(Array.isArray(draft.batch) ? draft.batch.map(({ enrollmentId, months, waiver }) => ({ enrollmentId, months, waiver })) : []);
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/collection-submissions?view=mine", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load your members.");
        setProfile(result.profile); setAccounts(result.accounts ?? []); setSubmissions(result.submissions ?? []); setError("");
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load your members."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  // A clerk saving or returning a batch shows here without reloading.
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useLiveRefresh(["collection_submissions", "collections"], reload, 3000);

  const branch = profile?.branches.find((item) => item.id === branchId) ?? profile?.branches[0];
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const month = today.slice(0, 7);
  const branchAccounts = accounts.filter((account) => account.branchId === branch?.id);
  const isDue = (account: Account) => !account.blocked && Boolean(account.nextMonth) && account.nextMonth <= month;
  const dueCount = branchAccounts.filter(isDue).length;
  const query = search.trim().toLowerCase();
  const listed = branchAccounts
    .filter((account) => (showAll || query ? true : isDue(account)) && (!query || `${account.memberName} ${account.memberNumber} ${account.programName}`.toLowerCase().includes(query)))
    // Most urgent first: closest to forfeiting, then by name.
    .sort((a, b) => Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) || (a.forfeitedAt || "9999").localeCompare(b.forfeitedAt || "9999") || a.memberName.localeCompare(b.memberName));

  const rows = batch.map((pick) => {
    const account = byId.get(pick.enrollmentId);
    const orDate = today;
    if (!account) return { pick, account, orDate, quote: null, problem: "This member is no longer in your list. Remove them." };
    if (account.blocked) return { pick, account, orDate, quote: null, problem: account.blocked };
    try { return { pick, account, orDate, quote: masCollectionQuote(account, pick.months), problem: "" }; }
    catch (failure) { return { pick, account, orDate, quote: null, problem: failure instanceof Error ? failure.message : "Cannot be collected." }; }
  });
  const needsWaiver = (account: Account | undefined, orDate: string) => Boolean(account?.suspendedAt && orDate >= account.suspendedAt);
  const totals = rows.reduce((sum, row) => row.quote ? { amount: sum.amount + row.quote.amount, incentive: sum.incentive + row.quote.incentive, remittance: sum.remittance + row.quote.remittance } : sum, { amount: 0, incentive: 0, remittance: 0 });
  const firstOrDate = rows.map((row) => row.orDate).sort()[0] ?? today;
  const deadline = branch ? incentiveDeadline(firstOrDate, { days: offDays, branch: branch.name }) : "";
  const missingWaiver = rows.filter((row) => needsWaiver(row.account, row.orDate) && !row.pick.waiver);
  const problems = rows.filter((row) => row.problem);

  const add = (account: Account) => {
    setMessage("");
    setBatch((current) => current.some((pick) => pick.enrollmentId === account.id) ? current : [...current, { enrollmentId: account.id, months: Math.max(1, Math.min(account.unpaidMonths || 1, MAX_SUBMISSION_MONTHS)), waiver: false }]);
    setSearch("");
  };
  const change = (id: string, update: Partial<BatchItem>) => setBatch((current) => current.map((pick) => pick.enrollmentId === id ? { ...pick, ...update } : pick));
  const remove = (id: string) => setBatch((current) => current.filter((pick) => pick.enrollmentId !== id));
  const reset = () => setBatch([]);

  async function submit() {
    if (!branch || !batch.length || busy) return;
    if (problems.length) { setMessage(`${problems[0].account?.memberName ?? "A member"}: ${problems[0].problem}`); return; }
    if (missingWaiver.length) { setMessage(`${missingWaiver[0].account?.memberName} is suspended. Have the member sign the Waiver, then tick Waiver.`); return; }
    if (!await confirmDialog(`Submit ${plural(batch.length, "member")} to the clerk? You cannot change it after this; the clerk checks it when you remit the cash. Collected ${money(cents(totals.amount))}; remit ${money(cents(totals.remittance))} by ${formatDeadline(deadline)} to keep your ${money(cents(totals.incentive))} incentive.`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/collection-submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId: branch.id, entries: batch.map(({ enrollmentId, months, waiver }) => ({ enrollmentId, months, waiver })) }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to submit.");
      reset(); setMessage(result.message); reload();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to submit."); }
    finally { setBusy(false); }
  }

  if (loading) return <p role="status" className="p-4">Loading your members...</p>;
  if (error) return <p role="alert" className="p-4 text-destructive">{error}</p>;

  return <div className="mx-auto max-w-3xl space-y-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Submit Collections</h1>
      <p className="text-sm text-muted-foreground">Add each member who paid you and how many months. Today is the OR date. The clerk of your branch types the OR numbers and saves them.</p>
    </div>

    {profile && profile.branches.length > 1 && <div role="radiogroup" aria-label="Branch" className="flex flex-wrap gap-2">
      {profile.branches.map((item) => <Button key={item.id} type="button" role="radio" aria-checked={branch?.id === item.id} variant={branch?.id === item.id ? "default" : "outline"} disabled={Boolean(batch.length) && branch?.id !== item.id} onClick={() => setBranchId(item.id)}>{item.name}</Button>)}
      {batch.length > 0 && <p className="w-full text-xs text-muted-foreground">One batch is one branch. Submit or clear this batch to switch branch.</p>}
    </div>}

    {message && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{message}</p>}

    {/* THE BATCH: each member with months paid, what it covers, the incentive and what to hand over. */}
    {rows.length > 0 && <section aria-label="This batch" className="space-y-3">
      <h2 className="text-lg font-semibold">This batch · {plural(rows.length, "member")}</h2>
      {rows.map(({ pick, account, orDate, quote, problem }) => <Card key={pick.enrollmentId} className={problem || (needsWaiver(account, orDate) && !pick.waiver) ? "border-amber-400" : ""}>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{account?.memberName ?? "Unknown member"}</p>
              <p className="truncate text-xs text-muted-foreground">{account ? `${account.memberNumber} · ${account.programName}` : ""} · OR date {formatDate(orDate)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`Remove ${account?.memberName ?? "member"}`} onClick={() => remove(pick.enrollmentId)}><Trash2 className="h-5 w-5" /></Button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Months paid</span>
            <div className="flex items-center rounded-lg border">
              <Button type="button" variant="ghost" className="h-11 w-11 rounded-r-none" aria-label="One month less" disabled={pick.months <= 1} onClick={() => change(pick.enrollmentId, { months: pick.months - 1 })}><Minus className="h-5 w-5" /></Button>
              <Input type="number" inputMode="numeric" min={1} max={MAX_SUBMISSION_MONTHS} aria-label="Months paid" className="h-11 w-16 rounded-none border-0 border-x text-center text-lg font-semibold"
                value={pick.months || ""} onChange={(event) => change(pick.enrollmentId, { months: Math.min(MAX_SUBMISSION_MONTHS, Math.max(0, Math.floor(Number(event.target.value) || 0))) })} />
              <Button type="button" variant="ghost" className="h-11 w-11 rounded-l-none" aria-label="One month more" disabled={pick.months >= MAX_SUBMISSION_MONTHS} onClick={() => change(pick.enrollmentId, { months: pick.months + 1 })}><Plus className="h-5 w-5" /></Button>
            </div>
          </div>

          {quote && <>
            <p className="text-sm text-muted-foreground">Covers <strong className="text-foreground">{monthsText(quote.monthFrom, quote.monthTo)}</strong> · NOP {quote.nopFrom === quote.nopTo ? quote.nopFrom : `${quote.nopFrom}–${quote.nopTo}`}</p>
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center">
              <div><dt className="text-[11px] text-muted-foreground">Collect</dt><dd className="font-semibold tabular-nums">{money(quote.amount)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">Your incentive</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(quote.incentive)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground">To remit</dt><dd className="font-semibold tabular-nums">{money(quote.remittance)}</dd></div>
            </dl>
          </>}
          {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}

          {/* A suspended account takes a payment only with the member's signed Waiver (lib/account-rules.ts). */}
          {needsWaiver(account, orDate) && <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${pick.waiver ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"}`}>
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={pick.waiver} onChange={(event) => change(pick.enrollmentId, { waiver: event.target.checked })} />
            <span><strong>Waiver *</strong> Suspended since {formatDate(account?.suspendedAt)}. Tick only after the member signs the Waiver; bring it with the cash.</span>
          </label>}
        </CardContent>
      </Card>)}
    </section>}

    {/* MEMBERS: the MAS's own accounts in this branch; those still owing this month first. */}
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <CardTitle className="text-lg">Add a member who paid</CardTitle>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="h-11 pl-9 text-base" placeholder="Search name, PH number or program" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search your members" />
        </div>
        {!query && <div role="radiogroup" aria-label="Which members" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1 text-sm">
          {([[false, `To collect (${dueCount})`], [true, `All (${branchAccounts.length})`]] as const).map(([value, label]) => <button key={label} type="button" role="radio" aria-checked={showAll === value} onClick={() => setShowAll(value)}
            className={`min-h-10 rounded-md px-3 font-semibold ${showAll === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
        </div>}
      </CardHeader>
      <CardContent>
        {listed.length ? <ul className="divide-y">
          {listed.map((account) => {
            const inBatch = batch.some((pick) => pick.enrollmentId === account.id);
            const waiting = Boolean(account.pendingIn);
            return <li key={account.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2"><span className="truncate font-semibold">{account.memberName}</span><Badge className={`shrink-0 border font-mono text-[10px] ${mamStatusClass(account.status)}`}>{account.status}</Badge></p>
                <p className="truncate text-xs text-muted-foreground">{account.memberNumber} · {account.programName} · {money(account.basePay)}/month</p>
                {account.blocked ? <p className="text-xs text-destructive">{account.blocked}</p> : <p className="text-xs text-muted-foreground">Next month due {formatMonth(account.nextMonth)}{account.unpaidMonths > 1 ? ` · ${account.unpaidMonths} months behind` : ""}</p>}
                {!account.blocked && account.temporarilySuspended && <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Suspended: Waiver needed · forfeits {formatDate(account.forfeitedAt)}</p>}
              </div>
              {inBatch ? <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Added</span>
                : waiting ? <span className="max-w-24 shrink-0 text-right text-xs text-muted-foreground">Waiting in a submission</span>
                : <Button type="button" className="h-11 shrink-0 px-4" disabled={Boolean(account.blocked)} onClick={() => add(account)}><Plus className="mr-1 h-4 w-4" />Add</Button>}
            </li>;
          })}
        </ul> : <p className="py-6 text-center text-sm text-muted-foreground">{query ? "No member matches your search." : showAll ? "You have no members in this branch." : "Everyone is paid through this month. Tap All to collect an advance."}</p>}
      </CardContent>
    </Card>

    <MySubmissions submissions={submissions} />

    {/* TOTALS AND SUBMIT: kept at the bottom of the screen while the batch is filled. */}
    {rows.length > 0 && <div className="sticky bottom-0 z-20 rounded-t-xl border bg-card p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[11px] text-muted-foreground">Collected</p><p className="font-bold tabular-nums">{money(cents(totals.amount))}</p></div>
          <div><p className="text-[11px] text-muted-foreground">Your incentive</p><p className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(cents(totals.incentive))}</p></div>
          <div><p className="text-[11px] text-muted-foreground">To remit</p><p className="font-bold tabular-nums">{money(cents(totals.remittance))}</p></div>
        </div>
        {deadline && <p className="text-center text-xs text-muted-foreground">Remit at the office by <strong className="text-foreground">{formatDeadline(deadline)}</strong> to keep the incentive. Later, the whole {money(cents(totals.amount))} is remitted. Check before submitting: only the clerk can change it after.</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-12" aria-label="Clear the batch" onClick={async () => { if (await confirmDialog("Remove every member from this batch?")) reset(); }}><X className="h-5 w-5" /></Button>
          <Button type="button" className="h-12 flex-1 text-base" disabled={busy || Boolean(problems.length)} onClick={() => void submit()}>{busy ? "Submitting..." : `Submit ${plural(rows.length, "member")}`}</Button>
        </div>
      </div>
    </div>}
  </div>;
}

/**
 * The MAS's submissions, read only. Only the clerk changes one: the clerk marks it Remitted when the cash is handed over
 * (a MAS cannot mark it themselves; that time decides the incentive), then types the OR numbers and saves it.
 */
function MySubmissions({ submissions }: { submissions: Submission[] }) {
  if (!submissions.length) return null;
  const now = manilaNow();
  const tone = { Submitted: "secondary", Remitted: "default", Rejected: "destructive", Saved: "default" } as const;
  const label = { Submitted: "Not yet remitted", Remitted: "Remitted: being encoded", Rejected: "Rejected", Saved: "Saved by the clerk" } as const;
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-lg">My submissions</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {submissions.map((submission) => {
        const late = submission.status === "Submitted" && submission.incentiveDeadline && `${now.date} ${now.time}` > submission.incentiveDeadline;
        return <div key={submission.id} className="space-y-2 rounded-lg border p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold">{formatDateTime(submission.submittedAt)} <Badge variant={tone[submission.status]}>{label[submission.status]}</Badge></p>
          <p className="text-muted-foreground">{plural(submission.entryCount, "member")} · {money(submission.totalAmount)} collected · incentive {money(submission.totalIncentive)} · {submission.branch}</p>
          <p className="line-clamp-2">{submission.entries.map((entry) => `${entry.memberName} (${plural(entry.months, "month")})`).join(", ")}</p>
          {submission.status === "Submitted" && submission.incentiveDeadline && <p className={late ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
            {late ? `The ${formatDeadline(submission.incentiveDeadline)} deadline has passed: if you have not remitted the cash yet, remit the whole ${money(submission.totalAmount)}.` : `Remit ${money(Math.round((submission.totalAmount - submission.totalIncentive) * 100) / 100)} at the office by ${formatDeadline(submission.incentiveDeadline)} to keep the incentive.`}
          </p>}
          {submission.status === "Remitted" && submission.remittedAt && <p className={submission.incentiveDeadline && submission.remittedAt > submission.incentiveDeadline ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium text-emerald-700 dark:text-emerald-400"}>
            Received by {submission.remittedByName || "the clerk"} on {formatDateTime(submission.remittedAt)}{submission.incentiveDeadline ? (submission.remittedAt > submission.incentiveDeadline ? ": after the deadline, the incentive is forfeited." : ": in time, you keep your incentive.") : "."}
          </p>}
          {submission.status === "Rejected" && <p className="font-medium text-destructive">Rejected{submission.reviewedByName ? ` by ${submission.reviewedByName}` : ""}: {submission.returnReason}. These members can be added to a new batch.</p>}
          {submission.status === "Saved" && submission.reviewedByName && <p className="text-muted-foreground">Checked and saved by {submission.reviewedByName}</p>}
        </div>;
      })}
    </CardContent>
  </Card>;
}
