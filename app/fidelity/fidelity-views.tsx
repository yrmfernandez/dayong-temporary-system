"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, HandCoins, PiggyBank, Target, Users } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { SearchSelect } from "@/components/ui/search-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Account = { masEmployeeId: string; masName: string; employmentStatus: string; approved: number; pending: number; claimed: number; locked: number; withdrawable: number; remaining: number; separated: boolean; readyForRelease: boolean };
type Transaction = { id: string; masEmployeeId: string; masName: string; date: string; status: string; amount: number; type: string; encodedBy: string };
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
  return { data, error, setError, load };
}

/** The signed-in employee's own Fidelity savings, whatever their role. */
export function MyFidelity() {
  const { data, error } = useFidelity("me");
  const cap = data?.cap ?? 10000;
  const account: Account = data?.accounts.find((item) => item.masEmployeeId === data.currentEmployeeId)
    ?? { masEmployeeId: data?.currentEmployeeId ?? "", masName: data?.currentName ?? "", employmentStatus: "", approved: 0, pending: 0, claimed: 0, locked: 0, withdrawable: 0, remaining: cap, separated: false, readyForRelease: false };
  // The bar shows progress toward the locked amount; savings above it are withdrawable.
  const progress = Math.min(100, Math.round((account.locked / cap) * 1000) / 10);
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
        {data && <StatusBadge status={account.withdrawable > 0 ? "Excess withdrawable" : "Saving"} tone={account.withdrawable > 0 ? "success" : "info"} />}
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
            {`The first ${money(cap)} stays locked until you leave the company. `}
            {account.withdrawable > 0
              ? `${money(account.withdrawable)} above it can be withdrawn any time through Finance.`
              : `${money(account.remaining)} more until the locked amount is complete; anything above it can be withdrawn any time.`}
            {account.pending ? ` ${money(account.pending)} is waiting for remittance approval.` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="success" icon={CheckCircle2} label="Current balance" value={money(account.approved)} detail="Approved savings" />
        <MetricTile tone="warning" icon={Clock3} label="Pending" value={money(account.pending)} detail="Awaiting remittance approval" />
        <MetricTile tone="info" icon={Target} label="Withdrawable now" value={money(account.withdrawable)} detail={`Balance above ${money(cap)}`} />
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
                  <td className="p-3">{item.date}</td>
                  <td className="p-3 font-mono text-xs">{item.id}</td>
                  <td className="p-3">{item.type}</td>
                  <td className="p-3 font-semibold tabular-nums">{item.type === "Contribution" ? "+" : "−"}{money(item.amount)}</td>
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

/** Company-wide monitoring for Finance, executives, and administrators. */
export function FidelityMonitoring() {
  const { data, error, setError, load } = useFidelity("all");
  const [message, setMessage] = useState("");
  // Pick one MAS from the dropdown (searchable) to focus both the balances and the history on them.
  const [masId, setMasId] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts = useMemo(() => data?.accounts.filter((item) => !masId || item.masEmployeeId === masId) ?? [], [data, masId]);
  const transactions = useMemo(() => data?.transactions.filter((item) => !masId || item.masEmployeeId === masId) ?? [], [data, masId]);
  const total = accounts.reduce((sum, item) => sum + item.approved, 0);
  const pending = accounts.reduce((sum, item) => sum + item.pending, 0);

  // An excess withdrawal takes part or all of the balance above the cap; a separation release pays out everything.
  async function withdraw(account: Account, kind: "excess" | "separation") {
    let amount = account.approved;
    if (kind === "excess") {
      const entered = window.prompt(`Amount to withdraw for ${account.masName} (up to ${money(account.withdrawable)}):`, String(account.withdrawable));
      if (entered === null) return;
      amount = Number(entered);
      if (!(amount > 0) || amount > account.withdrawable) { setError(`Enter an amount from ₱0.01 to ${money(account.withdrawable)}.`); return; }
    } else if (!window.confirm(`Release the whole ${money(account.approved)} Fidelity balance to ${account.masName}, who has left the company?`)) return;
    const notes = window.prompt("Reference or notes (optional):") ?? "";
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/fidelity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masEmployeeId: account.masEmployeeId, kind, amount, notes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to record the withdrawal.");
      setMessage(result.message); await load();
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
          <p className="mt-1 text-sm text-muted-foreground">Fidelity is the employee&apos;s own money added to their remittances, with no limit. The first {money(data?.cap ?? 10000)} is released only when the employee leaves the company; anything above it can be withdrawn any time.</p>
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
        <MetricTile tone="teal" icon={CheckCircle2} label="With withdrawable excess" value={String(accounts.filter((item) => item.withdrawable > 0).length)} detail={money(accounts.reduce((sum, item) => sum + item.withdrawable, 0))} />
      </div>
      <div className="max-w-md space-y-1">
        <SearchSelect aria-label="Find a MAS" className="h-10" clearable placeholder={data.accounts.length ? "All MAS - search name or employee ID" : "No MAS yet"} disabled={!data.accounts.length} value={masId} onValueChange={setMasId}
          options={data.accounts.map((item) => ({ value: item.masEmployeeId, label: item.masName, description: `${item.masEmployeeId} · balance ${money(item.approved)}` }))} />
        {!data.accounts.length && <p className="text-xs text-muted-foreground">Every active employee can hand over Fidelity with a remittance and appears here; none are registered yet.</p>}
      </div>
      <Card>
        <CardHeader><CardTitle>MAS balances</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr>{["Employee", "Balance", `Locked (first ${money(data.cap)})`, "Withdrawable", "Pending", "Withdrawn", "Status", "Action"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {accounts.map((item) => <tr key={item.masEmployeeId} className="border-t">
                  <td className="p-3 font-medium">{item.masName}<span className="block text-xs font-normal text-muted-foreground">{item.masEmployeeId}</span></td>
                  <td className="p-3 font-semibold tabular-nums">{money(item.approved)}</td>
                  <td className="p-3 tabular-nums">{money(item.locked)}</td>
                  <td className="p-3 tabular-nums">{money(item.withdrawable)}</td>
                  <td className="p-3 tabular-nums">{money(item.pending)}</td>
                  <td className="p-3 tabular-nums">{money(item.claimed)}</td>
                  <td className="p-3"><StatusBadge status={item.separated ? `Left (${item.employmentStatus})` : item.withdrawable > 0 ? "Excess withdrawable" : "Saving"} tone={item.separated ? "warning" : item.withdrawable > 0 ? "success" : "info"} /></td>
                  <td className="p-3">{data.canClaim && (item.withdrawable > 0 || item.readyForRelease) ? <div className="flex flex-wrap gap-2">
                    {item.withdrawable > 0 && !item.separated && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void withdraw(item, "excess")}>Withdraw excess</Button>}
                    {item.readyForRelease && <Button type="button" size="sm" disabled={busy} onClick={() => void withdraw(item, "separation")}>Release all (left company)</Button>}
                  </div> : "—"}</td>
                </tr>)}
                {!accounts.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No Fidelity records found.</td></tr>}
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
              <thead><tr>{["Date", "Reference", "Employee", "Type", "Amount", "Status", "Encoded by"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {transactions.map((item) => <tr key={item.id} className="border-t">
                  <td className="p-3">{item.date}</td>
                  <td className="p-3 font-mono text-xs">{item.id}</td>
                  <td className="p-3">{item.masName}</td>
                  <td className="p-3">{item.type}</td>
                  <td className="p-3 font-semibold tabular-nums">{item.type === "Contribution" ? "+" : "−"}{money(item.amount)}</td>
                  <td className="p-3"><StatusBadge status={item.status} /></td>
                  <td className="p-3">{item.encodedBy || "—"}</td>
                </tr>)}
                {!transactions.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No Fidelity activity has been recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>}
  </section>;
}
