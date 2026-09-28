"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, HandCoins, PiggyBank, Target, Users } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Account = { masEmployeeId: string; masName: string; approved: number; pending: number; claimed: number; remaining: number; readyForRelease: boolean };
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
    ?? { masEmployeeId: data?.currentEmployeeId ?? "", masName: data?.currentName ?? "", approved: 0, pending: 0, claimed: 0, remaining: cap, readyForRelease: false };
  const progress = Math.min(100, Math.round((account.approved / cap) * 1000) / 10);
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
        {data && <StatusBadge status={account.readyForRelease ? "Ready to claim" : "Saving"} tone={account.readyForRelease ? "success" : "info"} />}
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {data && <>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">Saved toward your {money(cap)} Fidelity</p>
              <p className="text-3xl font-bold tabular-nums">{money(account.approved)}</p>
            </div>
            <p className="text-sm font-semibold text-muted-foreground tabular-nums">{progress}%</p>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={account.approved} aria-label="Fidelity savings progress">
            <div className="h-full bg-gradient-to-r from-brand-teal to-brand-lime transition-[width]" style={{ width: `${progress}%` }} />
            <div className="h-full bg-brand-gold/60" style={{ width: `${pendingProgress}%` }} title="Pending approval" />
          </div>
          <p className="text-sm text-muted-foreground">
            {account.readyForRelease
              ? "You have reached the Fidelity cap. Coordinate with Finance to claim it; your balance resets to zero after the claim is recorded."
              : `${money(account.remaining)} to go.${account.pending ? ` ${money(account.pending)} is waiting for remittance approval.` : ""}`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricTile tone="success" icon={CheckCircle2} label="Current balance" value={money(account.approved)} detail="Approved savings" />
        <MetricTile tone="warning" icon={Clock3} label="Pending" value={money(account.pending)} detail="Awaiting remittance approval" />
        <MetricTile tone="info" icon={Target} label="Remaining to cap" value={money(account.remaining)} detail={`Cap ${money(cap)}`} />
        <MetricTile tone="teal" icon={HandCoins} label="Previously claimed" value={money(account.claimed)} detail="Total paid out" />
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
                  <td className="p-3 font-semibold tabular-nums">{item.type === "Claim" ? "−" : "+"}{money(item.amount)}</td>
                  <td className="p-3"><StatusBadge status={item.status} /></td>
                  <td className="p-3">{item.encodedBy || "—"}</td>
                </tr>)}
                {!history.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No Fidelity savings yet. Fidelity is set aside from your MAS incentive when your remittance is encoded.</td></tr>}
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
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts = useMemo(() => data?.accounts.filter((item) => `${item.masName} ${item.masEmployeeId}`.toLowerCase().includes(search.toLowerCase())) ?? [], [data, search]);
  const total = accounts.reduce((sum, item) => sum + item.approved, 0);
  const pending = accounts.reduce((sum, item) => sum + item.pending, 0);

  async function claim(account: Account) {
    if (!window.confirm(`Record the ${money(data?.cap ?? 10000)} Fidelity claim for ${account.masName}? Their current balance will reset to zero.`)) return;
    const notes = window.prompt("Claim reference or notes (optional):") ?? "";
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/fidelity", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masEmployeeId: account.masEmployeeId, notes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to record claim.");
      setMessage(result.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to record claim."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6">
    <header className="page-hero">
      <div className="flex items-center gap-4">
        <div className="tone-soft tone-teal rounded-2xl p-3"><PiggyBank className="size-8" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">MAS savings</p>
          <h1 className="text-2xl font-bold">Fidelity Monitoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every MAS balance. A balance becomes claimable at {money(data?.cap ?? 10000)} and resets to zero after the claim is recorded; previous claims remain in history.</p>
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
        <MetricTile tone="teal" icon={CheckCircle2} label="Ready to claim" value={String(accounts.filter((item) => item.readyForRelease).length)} />
      </div>
      <input className="w-full max-w-md rounded-lg border bg-background p-2.5 text-sm" placeholder="Search MAS name or employee ID" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Card>
        <CardHeader><CardTitle>MAS balances</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr>{["MAS", "Current balance", "Pending", "Previously claimed", `Remaining to ${money(data.cap)}`, "Status", "Action"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {accounts.map((item) => <tr key={item.masEmployeeId} className="border-t">
                  <td className="p-3 font-medium">{item.masName}<span className="block text-xs font-normal text-muted-foreground">{item.masEmployeeId}</span></td>
                  <td className="p-3 font-semibold tabular-nums">{money(item.approved)}</td>
                  <td className="p-3 tabular-nums">{money(item.pending)}</td>
                  <td className="p-3 tabular-nums">{money(item.claimed)}</td>
                  <td className="p-3 tabular-nums">{money(item.remaining)}</td>
                  <td className="p-3"><StatusBadge status={item.readyForRelease ? "Ready to claim" : "Saving"} tone={item.readyForRelease ? "success" : "info"} /></td>
                  <td className="p-3">{data.canClaim && item.readyForRelease ? <Button type="button" size="sm" disabled={busy} onClick={() => void claim(item)}>Record claim</Button> : "—"}</td>
                </tr>)}
                {!accounts.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No MAS Fidelity records found.</td></tr>}
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
              <thead><tr>{["Date", "Reference", "MAS", "Type", "Amount", "Status", "Encoded by"].map((item) => <th key={item} className="p-3">{item}</th>)}</tr></thead>
              <tbody>
                {data.transactions.map((item) => <tr key={item.id} className="border-t">
                  <td className="p-3">{item.date}</td>
                  <td className="p-3 font-mono text-xs">{item.id}</td>
                  <td className="p-3">{item.masName}</td>
                  <td className="p-3">{item.type}</td>
                  <td className="p-3 font-semibold tabular-nums">{money(item.amount)}</td>
                  <td className="p-3"><StatusBadge status={item.status} /></td>
                  <td className="p-3">{item.encodedBy || "—"}</td>
                </tr>)}
                {!data.transactions.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No Fidelity activity has been recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>}
  </section>;
}
