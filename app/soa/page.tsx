"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import type { StatementOfAccount } from "@/lib/statement-of-account";

type AccountOption = { id: string; memberName: string; memberNumber: string; programName: string; branch: string; mas: string; doi: string; status: string };
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const longDate = (value: string) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const monthLabel = (value: string) => value ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const statusText: Record<string, string> = { NS: "New sale, no collection yet", U: "Updated", ADV: "Paid in advance", "60D": "60 days behind", "90D": "90 days behind", "120D": "120 days behind", "150D": "150 days behind", Paid: "Fully paid", Forfeited: "Forfeited" };

export default function StatementOfAccountPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}><StatementContent /></Suspense>;
}

/** Statement of Account for a member's program enrollment, ready to print or hand to the member. */
function StatementContent() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const selected = params.get("account") ?? "";
  const [accounts, setAccounts] = useState<AccountOption[]>([]), [statement, setStatement] = useState<StatementOfAccount | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");

  const loadAccounts = useCallback(async () => {
    try { const response = await fetch("/api/soa", { cache: "no-store" }), result = await response.json(); if (!response.ok) throw new Error(result.message); setAccounts(result.accounts ?? []); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load accounts."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the loading state for the chosen account
    setLoading(true); setError("");
    fetch(`/api/soa?account=${encodeURIComponent(selected)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      if (!cancelled) setStatement(result.statement);
    }).catch((failure) => { if (!cancelled) { setStatement(null); setError(failure instanceof Error ? failure.message : "Unable to prepare the statement."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const choose = (id: string) => router.replace(id ? `${pathname}?account=${encodeURIComponent(id)}` : pathname, { scroll: false });
  const s = statement?.summary;
  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div><p className="text-sm font-medium text-primary">Administration</p><h1 className="text-2xl font-bold">Statement of Account</h1><p className="text-sm text-muted-foreground">Choose a member&apos;s program account to see its payments, standing, and amount due. Print it for the member.</p></div>
      {statement && <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print SOA</Button>}
    </header>
    <div className="max-w-xl print:hidden"><SearchSelect aria-label="Member account" className="h-10" clearable placeholder="Search member name, member no., or program" value={selected} onValueChange={choose} options={accounts.map((item) => ({ value: item.id, label: `${item.memberName} · ${item.programName}`, description: `${item.memberNumber} · ${item.branch} · MAS ${item.mas} · ${item.status}` }))} /></div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive print:hidden">{error}</p>}
    {loading && <p className="text-sm text-muted-foreground print:hidden">Preparing the statement...</p>}
    {!selected && !loading && <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground print:hidden">Select an account to prepare its Statement of Account.</p>}

    {statement && s && !loading && <article data-slot="card" className="soa-sheet space-y-6 rounded-2xl border bg-card p-6 text-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3"><BrandLogo className="size-14 object-contain" /><div><p className="text-base font-bold">D&apos; San Roque Dayong Providers Inc.</p><p className="text-xs text-muted-foreground">{statement.account.branch} Branch</p></div></div>
        <div className="text-right"><p className="text-lg font-black tracking-wide">STATEMENT OF ACCOUNT</p><p className="text-xs text-muted-foreground">As of {longDate(statement.statementDate)}</p><p className="text-xs text-muted-foreground">Account {statement.account.id}</p></div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title="Member">{[["Name", statement.member.name], ["Member no.", statement.member.number], ["Address", statement.member.address], ["Contact", statement.member.contact]]}</Block>
        <Block title="Plan">{[["Program", statement.account.programName], ["Date of issue (DOI)", longDate(statement.account.doi)], ["Application no.", statement.account.applicationNumber], ["Monthly due", money(statement.account.monthlyDue)], ["MAS", statement.account.mas]]}</Block>
      </div>

      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-4">
        <Figure label="Account status" value={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} tone={["U", "ADV", "Paid"].includes(s.status) ? "success" : s.status === "NS" ? "info" : s.status === "Forfeited" ? "neutral" : "danger"} /><span className="text-xs font-normal text-muted-foreground">{statusText[s.status] ?? s.status}</span></span>} />
        <Figure label="Amount due now" value={s.amountDue === null ? "Forfeited" : money(s.amountDue)} strong />
        <Figure label="Paid through" value={`${monthLabel(s.lastCoveredMonth)} · ${s.monthsPaid} month${s.monthsPaid === 1 ? "" : "s"}`} />
        <Figure label="Next due" value={`${monthLabel(s.nextMonth)} (NOP ${s.nextNop})`} />
      </div>
      {s.temporarilySuspended && s.status !== "Forfeited" && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">This account is temporarily suspended since {longDate(s.suspendedAt)}. It will be forfeited on {longDate(s.forfeitedAt)} unless updated.</p>}

      <div>
        <h2 className="mb-2 font-semibold">Payment History</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
          <thead><tr className="border-b text-xs uppercase text-muted-foreground">{["OR date", "OR no.", "Months covered", "NOP", "Amount", "Total paid"].map((h, i) => <th key={h} className={`py-2 pr-3 ${i > 3 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {statement.newSale && <tr className="border-b"><td className="py-2 pr-3">{longDate(statement.newSale.date)}</td><td className="py-2 pr-3">{statement.account.applicationNumber ? `App ${statement.account.applicationNumber}` : "—"}</td><td className="py-2 pr-3">New sale{statement.newSale.registration > 0 ? " · registration" : ""}</td><td className="py-2 pr-3">—</td><td className="py-2 pr-3 text-right tabular-nums">{money(statement.newSale.amount)}</td><td className="py-2 pr-3 text-right tabular-nums">{money(statement.newSale.amount)}</td></tr>}
            {statement.history.map((row) => <tr key={`${row.orNumber}-${row.nopFrom}`} className="border-b last:border-0"><td className="py-2 pr-3">{longDate(row.orDate)}</td><td className="py-2 pr-3">{row.orNumber}</td><td className="py-2 pr-3">{row.monthFrom === row.monthTo ? monthLabel(row.monthFrom) : `${monthLabel(row.monthFrom)} – ${monthLabel(row.monthTo)}`}</td><td className="py-2 pr-3">{row.nopFrom === row.nopTo ? row.nopFrom : `${row.nopFrom}–${row.nopTo}`}</td><td className="py-2 pr-3 text-right tabular-nums">{money(row.amount)}</td><td className="py-2 pr-3 text-right tabular-nums">{money(row.runningTotal + (statement.newSale?.amount ?? 0))}</td></tr>)}
            {!statement.history.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No collections recorded yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <dl className="ml-auto max-w-sm space-y-1.5 border-t pt-4">
        <Row label="Total paid" value={money(s.totalPaid)} />
        {s.remainingBalance !== null && <Row label={`Remaining to pay-the-balance (${money(statement.account.payBalanceTotal)})`} value={money(s.remainingBalance)} />}
        <Row label="Months behind" value={String(s.unpaidMonths)} />
        <Row label="Amount due now" value={s.amountDue === null ? "Forfeited" : money(s.amountDue)} strong />
      </dl>

      <p className="border-t pt-4 text-xs text-muted-foreground">Payments are applied to monthly installments in order. An account two months behind is temporarily suspended and is forfeited six months after its last covered month. Please present official receipts for any payment not listed. This statement was generated from company records on {longDate(statement.statementDate)}.</p>
    </article>}
  </section>;
}

function Block({ title, children }: { title: string; children: string[][] }) {
  return <div><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2><dl className="space-y-1">{children.map(([label, value]) => <div key={label} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>)}</dl></div>;
}
function Figure({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className={`mt-1 tabular-nums ${strong ? "text-xl font-bold" : "font-semibold"}`}>{value}</div></div>;
}
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt><dd className={`tabular-nums ${strong ? "text-base font-bold" : "font-medium"}`}>{value}</dd></div>;
}
