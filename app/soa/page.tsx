"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Printer, Save } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import type { StatementOfAccount } from "@/lib/statement-of-account";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type AccountOption = { id: string; memberName: string; memberNumber: string; programName: string; branch: string; mas: string; doi: string; status: string; temporarilySuspended: boolean };
type Filters = { search: string; branch: string; mas: string; program: string; status: string };
const noFilters: Filters = { search: "", branch: "", mas: "", program: "", status: "" };
const fieldClass = "mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const statusFilters: Array<[string, string]> = [["U", "U - Updated"], ["ADV", "ADV - Advance"], ["NS", "NS - New sale"], ["60D", "60D"], ["90D", "90D"], ["120D", "120D"], ["150D", "150D"], ["Suspended", "Temporarily suspended"], ["Forfeited", "Forfeited"], ["Paid", "Fully paid"], ["Needs review", "Needs review"]];
const matchesStatus = (item: AccountOption, status: string) => !status || (status === "Suspended" ? item.temporarilySuspended && item.status !== "Forfeited" : item.status === status);
const statusLabel = (item: AccountOption) => `${item.status}${item.temporarilySuspended && item.status !== "Forfeited" ? " · suspended" : ""}`;
const statusTone = (status: string) => ["U", "ADV", "Paid"].includes(status) ? "success" as const : status === "NS" ? "info" as const : status === "Needs review" ? "warning" as const : "danger" as const;
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
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [canSetSignatories, setCanSetSignatories] = useState(false), [headDraft, setHeadDraft] = useState(""), [savingHead, setSavingHead] = useState(false), [headMessage, setHeadMessage] = useState("");
  const filtering = Object.values(filters).some(Boolean);
  // Filters narrow the account picker and the list below it, so a member is easy to find among many accounts.
  const filtered = useMemo(() => {
    const words = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return accounts.filter((item) => (!filters.branch || item.branch === filters.branch) && (!filters.mas || item.mas === filters.mas) && (!filters.program || item.programName === filters.program) && matchesStatus(item, filters.status)
      && words.every((word) => `${item.memberName} ${item.memberNumber} ${item.programName} ${item.id}`.toLowerCase().includes(word)));
  }, [accounts, filters]);
  const update = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  const loadAccounts = useCallback(async () => {
    try { const response = await fetch("/api/soa", { cache: "no-store" }), result = await response.json(); if (!response.ok) throw new Error(result.message); setAccounts(result.accounts ?? []); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load accounts."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  // Live updates (lib/use-live-refresh.ts): the account list and the open statement reload when payments or enrollments change.
  const [liveRevision, setLiveRevision] = useState(0);
  useLiveRefresh(["member_programs", "members", "collections", "sales", "programs", "system_settings"], () => { void loadAccounts(); setLiveRevision((value) => value + 1); }, 10000);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the loading state for the chosen account
    setLoading(true); setError("");
    fetch(`/api/soa?account=${encodeURIComponent(selected)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      if (!cancelled) { setStatement(result.statement); setCanSetSignatories(Boolean(result.canSetSignatories)); setHeadDraft(result.statement.signatories.collectionHead); setHeadMessage(""); }
    }).catch((failure) => { if (!cancelled) { setStatement(null); setError(failure instanceof Error ? failure.message : "Unable to prepare the statement."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, liveRevision]);

  // The Collection Department Head is one company-wide name, printed on every SOA.
  const saveHead = async () => {
    setSavingHead(true); setHeadMessage("");
    try {
      const response = await fetch("/api/soa", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionHead: headDraft }) }), result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setHeadDraft(result.collectionHead);
      setStatement((current) => current && { ...current, signatories: { ...current.signatories, collectionHead: result.collectionHead } });
      setHeadMessage("Saved. It prints on every SOA.");
    } catch (failure) { setHeadMessage(failure instanceof Error ? failure.message : "Unable to save."); }
    finally { setSavingHead(false); }
  };
  const choose = (id: string) => router.replace(id ? `${pathname}?account=${encodeURIComponent(id)}` : pathname, { scroll: false });
  const s = statement?.summary;
  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div><p className="text-sm font-medium text-primary">Administration</p><h1 className="text-2xl font-bold">Statement of Account</h1><p className="text-sm text-muted-foreground">Choose a member&apos;s program account to see its payments, standing, and amount due. Print it for the member.</p></div>
      {statement && <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print SOA</Button>}
    </header>
    <div className="space-y-3 rounded-xl border bg-background p-4 print:hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">Search<input className={fieldClass} value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Name, member no., program" /></label>
        <label className="text-sm">Branch<SearchSelect aria-label="Branch" className="mt-1 h-9" clearable placeholder="All" value={filters.branch} onValueChange={(value) => update("branch", value)} options={unique(accounts.map((item) => item.branch)).map((value) => ({ value, label: value }))} /></label>
        <label className="text-sm">MAS<SearchSelect aria-label="MAS" className="mt-1 h-9" clearable placeholder="All" value={filters.mas} onValueChange={(value) => update("mas", value)} options={unique(accounts.filter((item) => !filters.branch || item.branch === filters.branch).map((item) => item.mas)).map((value) => ({ value, label: value }))} /></label>
        <label className="text-sm">Program<SearchSelect aria-label="Program" className="mt-1 h-9" clearable placeholder="All" value={filters.program} onValueChange={(value) => update("program", value)} options={unique(accounts.map((item) => item.programName)).map((value) => ({ value, label: value }))} /></label>
        <label className="text-sm">Status (today)<select className={fieldClass} value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="">All</option>{statusFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 max-w-xl flex-1"><SearchSelect aria-label="Member account" className="h-10" clearable placeholder={filtering ? `Choose from ${filtered.length} matching account${filtered.length === 1 ? "" : "s"}` : "Search member name, member no., or program"} value={selected} onValueChange={choose} options={filtered.map((item) => ({ value: item.id, label: `${item.memberName} · ${item.programName}`, description: `${item.memberNumber} · ${item.branch} · MAS ${item.mas} · ${statusLabel(item)}` }))} /></div>
        <p className="text-sm text-muted-foreground" aria-live="polite">{filtered.length} of {accounts.length} accounts</p>
        {filtering && <Button type="button" variant="ghost" onClick={() => setFilters(noFilters)}>Reset filters</Button>}
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive print:hidden">{error}</p>}
    {loading && <p className="text-sm text-muted-foreground print:hidden">Preparing the statement...</p>}
    {!selected && !loading && (filtering && filtered.length ? <div className="overflow-x-auto rounded-xl border bg-background print:hidden">
      <table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["Member", "Member no.", "Program", "Branch", "MAS", "Status (today)", ""].map((label) => <th key={label || "action"} scope="col" className="whitespace-nowrap p-3">{label}</th>)}</tr></thead>
        <tbody>{filtered.slice(0, 50).map((item) => <tr key={item.id} className="border-t">
          <td className="p-3 font-medium">{item.memberName}</td><td className="p-3">{item.memberNumber}</td><td className="p-3">{item.programName}</td><td className="p-3">{item.branch}</td><td className="p-3">{item.mas}</td>
          <td className="p-3"><span className="flex flex-wrap gap-1"><StatusBadge status={item.status} tone={statusTone(item.status)} />{item.temporarilySuspended && item.status !== "Forfeited" && <StatusBadge status="Suspended" tone="warning" />}</span></td>
          <td className="p-3 text-right"><Button type="button" size="sm" variant="outline" onClick={() => choose(item.id)}>View SOA</Button></td>
        </tr>)}</tbody></table>
      {filtered.length > 50 && <p className="border-t p-3 text-sm text-muted-foreground">Showing the first 50 of {filtered.length}. Narrow the filters to find the member.</p>}
    </div> : <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground print:hidden">{filtering ? "No accounts match these filters." : "Filter or search, then select an account to prepare its Statement of Account."}</p>)}

    {statement && s && !loading && <article data-slot="card" className="soa-sheet space-y-6 rounded-2xl border bg-card p-6 text-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3"><BrandLogo className="size-14 object-contain" /><div><p className="text-base font-bold">D&apos; San Roque Dayong Providers Inc.</p><p className="text-xs text-muted-foreground">{statement.account.branch} Branch</p></div></div>
        <div className="text-right"><p className="text-lg font-black tracking-wide">STATEMENT OF ACCOUNT</p><p className="text-xs"><span className="text-muted-foreground">Date: </span><span className="font-semibold">{longDate(statement.statementDate)}</span></p><p className="text-xs text-muted-foreground">Account {statement.account.id}</p></div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title="Member">{[["Name", statement.member.name], ["Member no.", statement.member.number], ["Address", statement.member.address], ["Contact", statement.member.contact]]}</Block>
        <Block title="Account">{[["Program", statement.account.programName], ["Category", statement.account.programCategory], ["MAS", statement.account.mas], ["Date of issue (DOI)", longDate(statement.account.doi)], ["Application no.", statement.account.applicationNumber], ["Monthly due", money(statement.account.monthlyDue)]]}</Block>
      </div>

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

      <div className="rounded-xl border p-4">
        <h2 className="mb-3 font-semibold">Summary</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Figure label="Account status" value={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} tone={["U", "ADV", "Paid"].includes(s.status) ? "success" : s.status === "NS" ? "info" : s.status === "Forfeited" ? "neutral" : "danger"} /><span className="text-xs font-normal text-muted-foreground">{statusText[s.status] ?? s.status}</span></span>} />
          <Figure label="Total paid" value={<span>{money(s.totalPaid)}<span className="block text-xs font-normal text-muted-foreground">{s.totalPaidBasis.startsWith("NOP") ? `${s.monthsPaid} month${s.monthsPaid === 1 ? "" : "s"} × ${money(statement.account.monthlyDue)}` : "Flexible: every amount paid"}</span></span>} />
          <Figure label="Program balance" value={s.remainingBalance === null ? "No fixed total" : money(s.remainingBalance)} />
          <Figure label="Amount due now" value={s.amountDue === null ? "Forfeited" : money(s.amountDue)} strong />
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-1.5 border-t pt-3 sm:grid-cols-2">
          <Row label="Paid through" value={`${monthLabel(s.lastCoveredMonth)} · ${s.monthsPaid} month${s.monthsPaid === 1 ? "" : "s"}`} />
          <Row label="Next due" value={`${monthLabel(s.nextMonth)} (NOP ${s.nextNop})`} />
          <Row label="Months behind" value={String(s.unpaidMonths)} />
          {s.remainingBalance !== null && <Row label="Total amount payable" value={money(statement.account.payBalanceTotal)} />}
        </dl>
        {s.temporarilySuspended && s.status !== "Forfeited" && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">This account is temporarily suspended since {longDate(s.suspendedAt)}. It will be forfeited on {longDate(s.forfeitedAt)} unless updated.</p>}
      </div>

      <div className="grid gap-10 pt-6 sm:grid-cols-2">
        <Signature caption="Prepared by" name={statement.signatories.preparedBy} />
        <Signature caption="Collection Department Head" name={statement.signatories.collectionHead} />
      </div>
      {canSetSignatories && <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3 print:hidden">
        <label className="min-w-0 flex-1 text-xs text-muted-foreground">Collection Department Head (prints on every SOA)<input className={fieldClass} value={headDraft} maxLength={120} onChange={(event) => setHeadDraft(event.target.value)} placeholder="Full name" /></label>
        <Button type="button" size="sm" variant="outline" disabled={savingHead || headDraft.trim() === statement.signatories.collectionHead} onClick={() => void saveHead()}><Save className="size-4" />{savingHead ? "Saving..." : "Save"}</Button>
        {headMessage && <p className="w-full text-xs text-muted-foreground" aria-live="polite">{headMessage}</p>}
      </div>}

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
function Signature({ caption, name }: { caption: string; name: string }) {
  return <div className="text-center"><p className="min-h-5 font-semibold uppercase">{name}</p><p className="mt-1 border-t border-foreground/60 pt-1 text-xs text-muted-foreground">{caption}</p></div>;
}
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt><dd className={`tabular-nums ${strong ? "text-base font-bold" : "font-medium"}`}>{value}</dd></div>;
}
