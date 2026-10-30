"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { CashOutFields, cashOutReady, manilaToday, type CashOut } from "@/components/cash-out-fields";
import { CheckCircle2, Clock3, HandCoins, PiggyBank, Target, Users } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { SearchSelect } from "@/components/ui/search-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate as showDate } from "@/lib/date-format";
import { baseWithdrawalAmount } from "@/lib/fidelity-cap";

type Account = { masEmployeeId: string; masName: string; employmentStatus: string; branch?: string; roles?: string[]; approved: number; pending: number; claimed: number; base: number; excess: number; remaining: number; separated: boolean };
type Transaction = { id: string; masEmployeeId: string; masName: string; date: string; status: string; amount: number; type: string; direction: "in" | "out"; encodedBy: string; branch?: string; remarks?: string };
type Data = { canViewAll: boolean; canMonitor: boolean; canClaim: boolean; currentEmployeeId: string; currentName: string; cap: number; accounts: Account[]; transactions: Transaction[] };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

function useFidelity(scope: "all" | "me") {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/fidelity${scope === "me" ? "?scope=me" : ""}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Unable to load Fidelity.");
    setData(result);
  }, [scope]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((failure) => setError(failure instanceof Error ? failure.message : "Unable to load Fidelity."));
  }, [load]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["fidelity", "remittances", "collections", "sales", "cash_transactions"], () => load().catch(() => undefined));
  return { data, error, setError, load };
}

/** The signed-in employee's own Fidelity savings, whatever their role. */
export function MyFidelity() {
  const { data, error } = useFidelity("me");
  const cap = data?.cap ?? 10000;
  const account: Account = data?.accounts.find((item) => item.masEmployeeId === data.currentEmployeeId)
    ?? { masEmployeeId: data?.currentEmployeeId ?? "", masName: data?.currentName ?? "", employmentStatus: "", approved: 0, pending: 0, claimed: 0, base: 0, excess: 0, remaining: cap, separated: false };
  // The bar shows progress toward the base; savings above it are the excess.
  const progress = Math.min(100, Math.round((account.base / cap) * 1000) / 10);
  const pendingProgress = Math.min(100 - progress, Math.round((account.pending / cap) * 1000) / 10);
  const history = data?.transactions ?? [];

  return <section className="space-y-6">
    <header className="page-hero">
      <div className="flex flex-wrap items-center gap-4">
        <div className="tone-soft tone-teal rounded-2xl p-3"><PiggyBank className="size-8" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">My savings</p>
          <h1 className="text-2xl font-bold">My Fidelity</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data ? `${data.currentName} · ${data.currentEmployeeId}` : "Loading your savings..."}</p>
        </div>
        {data && <StatusBadge status={account.excess > 0 ? "Above the base" : "Saving"} tone={account.excess > 0 ? "success" : "info"} />}
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {data && <>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Your Fidelity balance</p>
              <p className="text-3xl font-bold tabular-nums">{money(account.approved)}</p>
            </div>
            <p className="text-sm font-semibold text-muted-foreground tabular-nums">{progress}%</p>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={account.approved} aria-label="Fidelity savings progress">
            <div className="h-full bg-gradient-to-r from-brand-teal to-brand-lime transition-[width]" style={{ width: `${progress}%` }} />
            <div className="h-full bg-brand-gold/60" style={{ width: `${pendingProgress}%` }} title="Pending approval" />
          </div>
          <p className="text-sm text-muted-foreground">
            {`Your savings are not locked: through Finance you may withdraw part of the first ${money(cap)} (a percentage or a fixed amount), the excess above it, or the whole balance, any time. `}
            {account.excess > 0
              ? `${money(account.excess)} is above the first ${money(cap)}.`
              : `${money(account.remaining)} more until you reach ${money(cap)}.`}
            {account.pending ? ` ${money(account.pending)} is waiting for remittance approval.` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="success" icon={CheckCircle2} label="Current balance" value={money(account.approved)} detail="Approved savings" />
        <MetricTile tone="warning" icon={Clock3} label="Pending" value={money(account.pending)} detail="Awaiting remittance approval" />
        <MetricTile tone="info" icon={Target} label="Excess" value={money(account.excess)} detail={`Balance above ${money(cap)}`} />
        <MetricTile tone="teal" icon={HandCoins} label="Withdrawn" value={money(account.claimed)} detail="Total paid out" />
      </div>

      <Card>
        <CardHeader><CardTitle>My Fidelity history</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr>{["Date", "Reference", "Type", "Amount", "Status", "Encoded by"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {history.map((item) => <tr key={item.id} className="border-t">
                  <td className="p-3">{showDate(item.date)}</td>
                  <td className="p-3 font-mono text-xs">{item.id}</td>
                  <td className="p-3">{item.type}{item.direction === "out" && item.remarks && <span className="block text-xs text-muted-foreground">{item.remarks}</span>}</td>
                  <td className="p-3 font-semibold tabular-nums">{item.direction === "in" ? "+" : "−"}{money(item.amount)}</td>
                  <td className="p-3"><StatusBadge status={item.status} /></td>
                  <td className="p-3">{item.encodedBy || "—"}</td>
                </tr>)}
                {!history.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No Fidelity savings yet. Fidelity is money you hand over with a remittance; it is added to that remittance and saved here.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>}
  </section>;
}

type Filters = { masId: string; branch: string; role: string; employment: string; standing: string; balance: string; from: string; to: string; type: string; status: string };
const emptyFilters: Filters = { masId: "", branch: "", role: "", employment: "", standing: "", balance: "", from: "", to: "", type: "", status: "" };
const field = "h-9 w-full rounded-md border bg-background px-2 text-sm";
/** An employee's Fidelity standing, as the Status column shows it. */
const STANDINGS: Array<[string, string]> = [["saving", "Saving (up to the base)"], ["excess", "Above the base (has excess)"], ["release", "Left the company, balance to pay out"], ["left", "Left the company, nothing to pay out"]];
const standingOf = (item: Account) => item.separated ? (item.approved > 0 ? "release" : "left") : item.excess > 0 ? "excess" : "saving";
type Kind = "base" | "excess" | "full";
const KIND_LABEL: Record<Kind, string> = { base: "Withdraw base", excess: "Withdraw excess", full: "Withdraw all" };

/** A labelled dropdown filter; `options` are values, or [value, label] pairs. */
function Choice({ label, value, onChange, all, options }: { label: string; value: string; onChange: (value: string) => void; all: string; options: Array<string | [string, string]> }) {
  return <label className="space-y-1 text-sm">{label}
    <select className={field} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{all}</option>
      {options.map((option) => { const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option.charAt(0).toUpperCase() + option.slice(1)]; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}
    </select>
  </label>;
}

/** Company-wide monitoring for Finance, executives, and administrators. */
export function FidelityMonitoring() {
  const { data, error, setError, load } = useFidelity("all");
  const [message, setMessage] = useState("");
  // Filters (owner, October 16, 2026): employee, branch, role, employment status and Fidelity standing narrow the
  // balances and the history; dates, type and status narrow the history (and the period totals).
  const [filters, setFilters] = useState(emptyFilters);
  const set = (key: keyof Filters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const masId = filters.masId;
  const [busy, setBusy] = useState(false);
  // The payout being recorded (owner, October 30, 2026): from the base by percentage or fixed amount, the excess, or
  // the whole balance, with where the cash came from.
  const [payout, setPayout] = useState<{ account: Account; kind: Kind; mode: "percent" | "fixed"; amount: string; notes: string; cash: CashOut } | null>(null);
  const options = useMemo(() => {
    const list = data?.accounts ?? [];
    const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return {
      branches: sorted(list.map((item) => item.branch ?? "")), roles: sorted(list.flatMap((item) => item.roles ?? [])),
      employment: sorted(list.map((item) => item.employmentStatus.toLowerCase())),
      types: sorted((data?.transactions ?? []).map((item) => item.type)), statuses: sorted((data?.transactions ?? []).map((item) => item.status)),
    };
  }, [data]);
  const accounts = useMemo(() => (data?.accounts ?? []).filter((item) => {
    if (masId && item.masEmployeeId !== masId) return false;
    if (filters.branch && (item.branch ?? "") !== filters.branch) return false;
    if (filters.role && !(item.roles ?? []).includes(filters.role)) return false;
    if (filters.employment && item.employmentStatus.toLowerCase() !== filters.employment) return false;
    if (filters.standing && standingOf(item) !== filters.standing) return false;
    if (filters.balance === "with" && !(item.approved > 0 || item.pending > 0)) return false;
    if (filters.balance === "none" && (item.approved > 0 || item.pending > 0)) return false;
    return true;
  }), [data, masId, filters]);
  const shownIds = useMemo(() => new Set(accounts.map((item) => item.masEmployeeId)), [accounts]);
  const branchOf = useMemo(() => new Map((data?.accounts ?? []).map((item) => [item.masEmployeeId, item.branch ?? ""])), [data]);
  const transactions = useMemo(() => (data?.transactions ?? []).filter((item) => {
    if (!shownIds.has(item.masEmployeeId)) return false;
    const day = item.date.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  }), [data, shownIds, filters]);
  const periodIn = transactions.filter((item) => item.direction === "in" && item.status === "Approved").reduce((sum, item) => sum + item.amount, 0);
  const periodOut = transactions.filter((item) => item.direction === "out").reduce((sum, item) => sum + item.amount, 0);
  const filtered = JSON.stringify(filters) !== JSON.stringify(emptyFilters);
  const total = accounts.reduce((sum, item) => sum + item.approved, 0);
  const pending = accounts.reduce((sum, item) => sum + item.pending, 0);

  const startPayout = (account: Account, kind: Kind) => {
    setError(""); setMessage("");
    setPayout((current) => current?.account.masEmployeeId === account.masEmployeeId && current.kind === kind ? null
      : { account, kind, mode: "percent", amount: kind === "excess" ? String(account.excess) : kind === "base" ? "100" : String(account.approved), notes: "", cash: { account: "", branch: account.branch ?? "", date: manilaToday() } });
  };
  /** What the payout pays: null when the entry is not a usable amount. */
  const payoutAmount = (current: NonNullable<typeof payout>) => {
    const { account, kind } = current, entered = Number(current.amount);
    if (kind === "full") return account.approved > 0 ? account.approved : null;
    if (kind === "base") return baseWithdrawalAmount(account.base, current.mode, entered);
    return entered > 0 && entered <= account.excess ? Math.round(entered * 100) / 100 : null;
  };
  async function withdraw() {
    if (!payout) return;
    const { account, kind, mode } = payout, paid = payoutAmount(payout);
    if (paid === null) {
      setError(kind === "base" && mode === "percent" ? "Enter a percentage from 0.01 to 100." : `Enter an amount from ₱0.01 to ${money(kind === "base" ? account.base : account.excess)}.`);
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/fidelity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masEmployeeId: account.masEmployeeId, kind, mode, amount: kind === "base" ? Number(payout.amount) : paid, notes: payout.notes, ...payout.cash }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to record the withdrawal.");
      setPayout(null); setMessage(`${result.message} The payout is in the cash ledger.`); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to record the withdrawal."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6">
    <header className="page-hero">
      <div className="flex items-center gap-4">
        <div className="tone-soft tone-teal rounded-2xl p-3"><PiggyBank className="size-8" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">Employee savings</p>
          <h1 className="text-2xl font-bold">Fidelity Monitoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fidelity is the employee&apos;s own money added to their remittances, with no limit. Nothing is locked: the first {money(data?.cap ?? 10000)} (the base) can be withdrawn by a percentage or a fixed amount, the excess above it on its own, or the whole balance at once.</p>
        </div>
      </div>
    </header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="brand" icon={Users} label="MAS accounts" value={String(accounts.length)} />
        <MetricTile tone="success" icon={PiggyBank} label="Current balances" value={money(total)} />
        <MetricTile tone="warning" icon={Clock3} label="Pending" value={money(pending)} detail="Awaiting remittance approval" />
        <MetricTile tone="teal" icon={CheckCircle2} label="With excess" value={String(accounts.filter((item) => item.excess > 0).length)} detail={money(accounts.reduce((sum, item) => sum + item.excess, 0))} />
      </div>
      <Card><CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm sm:col-span-2">Employee
            <SearchSelect aria-label="Find a MAS" className="h-9" clearable placeholder={data.accounts.length ? "All - search name or employee ID" : "No MAS yet"} disabled={!data.accounts.length} value={masId} onValueChange={set("masId")}
              options={data.accounts.map((item) => ({ value: item.masEmployeeId, label: item.masName, description: `${item.masEmployeeId}${item.branch ? ` · ${item.branch}` : ""} · balance ${money(item.approved)}` }))} />
          </label>
          <Choice label="Branch" value={filters.branch} onChange={set("branch")} all="All branches" options={options.branches} />
          <Choice label="Role" value={filters.role} onChange={set("role")} all="All roles" options={options.roles} />
          <Choice label="Employment" value={filters.employment} onChange={set("employment")} all="Any" options={options.employment} />
          <Choice label="Fidelity status" value={filters.standing} onChange={set("standing")} all="Any" options={STANDINGS} />
          <Choice label="Balance" value={filters.balance} onChange={set("balance")} all="Everyone" options={[["with", "With savings or pending"], ["none", "No savings yet"]]} />
          <label className="space-y-1 text-sm">History from<input type="date" className={field} value={filters.from} max={filters.to || undefined} onChange={(event) => set("from")(event.target.value)} /></label>
          <label className="space-y-1 text-sm">History to<input type="date" className={field} value={filters.to} min={filters.from || undefined} onChange={(event) => set("to")(event.target.value)} /></label>
          <Choice label="History type" value={filters.type} onChange={set("type")} all="All types" options={options.types} />
          <Choice label="History status" value={filters.status} onChange={set("status")} all="All statuses" options={options.statuses} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {filtered && <Button type="button" size="sm" variant="outline" onClick={() => setFilters(emptyFilters)}>Clear filters</Button>}
          <span className="text-muted-foreground">{accounts.length} of {data.accounts.length} employees · {transactions.length} history entr{transactions.length === 1 ? "y" : "ies"}{filters.from || filters.to ? ` · in the period: ${money(periodIn)} saved (approved), ${money(periodOut)} paid out` : ""}</span>
        </div>
        {!data.accounts.length && <p className="text-xs text-muted-foreground">Every active employee can hand over Fidelity with a remittance and appears here; none are registered yet.</p>}
      </CardContent></Card>
      <Card>
        <CardHeader><CardTitle>MAS balances</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr>{["Employee", "Balance", `Base (first ${money(data.cap)})`, "Excess", "Pending", "Withdrawn", "Status", "Action"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {accounts.map((item) => <Fragment key={item.masEmployeeId}><tr className="border-t">
                  <td className="p-3 font-medium">{item.masName}<span className="block text-xs font-normal text-muted-foreground">{item.masEmployeeId}</span></td>
                  <td className="p-3 font-semibold tabular-nums">{money(item.approved)}</td>
                  <td className="p-3 tabular-nums">{money(item.base)}</td>
                  <td className="p-3 tabular-nums">{money(item.excess)}</td>
                  <td className="p-3 tabular-nums">{money(item.pending)}</td>
                  <td className="p-3 tabular-nums">{money(item.claimed)}</td>
                  <td className="p-3"><StatusBadge status={item.separated ? `Left (${item.employmentStatus})` : item.excess > 0 ? "Above the base" : "Saving"} tone={item.separated ? "warning" : item.excess > 0 ? "success" : "info"} />{item.branch && <span className="mt-1 block text-xs text-muted-foreground">{item.branch}</span>}</td>
                  <td className="p-3">{data.canClaim && item.approved > 0 ? <div className="flex flex-wrap gap-2">
                    {item.base > 0 && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => startPayout(item, "base")}>{KIND_LABEL.base}</Button>}
                    {item.excess > 0 && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => startPayout(item, "excess")}>{KIND_LABEL.excess}</Button>}
                    <Button type="button" size="sm" disabled={busy} onClick={() => startPayout(item, "full")}>{KIND_LABEL.full}</Button>
                  </div> : "—"}</td>
                </tr>
                {payout?.account.masEmployeeId === item.masEmployeeId && <tr><td colSpan={8} className="border-t bg-muted/30 p-3">
                  <p className="mb-2 text-sm font-semibold">{payout.kind === "base" ? `Withdraw from ${item.masName}'s base (up to ${money(item.base)})` : payout.kind === "excess" ? `Withdraw from ${item.masName}'s excess (up to ${money(item.excess)})` : `Withdraw the whole ${money(item.approved)} of ${item.masName}'s Fidelity`}</p>
                  <CashOutFields value={payout.cash} onChange={(cash) => setPayout({ ...payout, cash })} />
                  <div className="mt-3 grid gap-3 sm:grid-cols-[16rem_1fr_auto] sm:items-end">
                    {payout.kind === "base" ? <div className="space-y-1 text-sm">
                      <div className="flex gap-2">
                        <select aria-label="Withdraw by" className={`${field} w-28`} value={payout.mode} onChange={(event) => setPayout({ ...payout, mode: event.target.value === "fixed" ? "fixed" : "percent", amount: event.target.value === "fixed" ? String(item.base) : "100" })}>
                          <option value="percent">Percent</option><option value="fixed">Fixed ₱</option>
                        </select>
                        <input type="number" min="0.01" step="0.01" max={payout.mode === "percent" ? 100 : item.base} aria-label={payout.mode === "percent" ? "Percentage of the base" : "Amount"} className={field} value={payout.amount} onChange={(event) => setPayout({ ...payout, amount: event.target.value })} />
                      </div>
                      <span className="block text-xs text-muted-foreground">{payoutAmount(payout) === null ? "Enter a usable amount" : `Pays ${money(payoutAmount(payout)!)}`}</span>
                    </div>
                    : <label className="space-y-1 text-sm">Amount<input type="number" min="0.01" step="0.01" max={item.excess} className={field} disabled={payout.kind === "full"} value={payout.kind === "full" ? String(item.approved) : payout.amount} onChange={(event) => setPayout({ ...payout, amount: event.target.value })} /></label>}
                    <label className="space-y-1 text-sm">Reference or notes (optional)<input className={field} value={payout.notes} onChange={(event) => setPayout({ ...payout, notes: event.target.value })} /></label>
                    <div className="flex gap-2"><Button type="button" disabled={busy || !cashOutReady(payout.cash)} onClick={() => void withdraw()}>Record payout</Button><Button type="button" variant="ghost" onClick={() => setPayout(null)}>Cancel</Button></div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Also recorded as a cash outflow from this account in the cash ledger, where the Fidelity came in with the remittances.</p>
                </td></tr>}</Fragment>)}
                {!accounts.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{filtered ? "No employees match these filters." : "No Fidelity records found."}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Fidelity history</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead><tr>{["Date", "Reference", "Employee", "Branch", "Type", "Amount", "Status", "Encoded by"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {transactions.map((item) => <tr key={item.id} className="border-t">
                  <td className="p-3">{showDate(item.date)}</td>
                  <td className="p-3 font-mono text-xs">{item.id}</td>
                  <td className="p-3">{item.masName}</td>
                  <td className="p-3">{item.branch || branchOf.get(item.masEmployeeId) || "—"}</td>
                  <td className="p-3">{item.type}{item.direction === "out" && item.remarks && <span className="block text-xs text-muted-foreground">{item.remarks}</span>}</td>
                  <td className="p-3 font-semibold tabular-nums">{item.direction === "in" ? "+" : "−"}{money(item.amount)}</td>
                  <td className="p-3"><StatusBadge status={item.status} /></td>
                  <td className="p-3">{item.encodedBy || "—"}</td>
                </tr>)}
                {!transactions.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{filtered ? "No Fidelity activity matches these filters." : "No Fidelity activity has been recorded."}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>}
  </section>;
}
