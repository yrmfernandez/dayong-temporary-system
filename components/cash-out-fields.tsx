"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";

export type CashOut = { account: string; branch: string; date: string };
type Options = { accounts: Array<{ id: string; name: string; status: string }>; branches: Array<{ name: string; territory: string }> };

export const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
export const cashOutReady = (value: CashOut) => Boolean(value.account && value.branch && value.date);

/**
 * Where a payout comes from (owner, October 24, 2026; upgrade #3): the cash account, the branch it is charged to and
 * the day paid. Commissions and Fidelity payouts record a cash outflow with these (lib/finance-operations.ts cashOutDetails).
 */
export function CashOutFields({ value, onChange }: { value: CashOut; onChange: (value: CashOut) => void }) {
  const [options, setOptions] = useState<Options>({ accounts: [], branches: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/finance-options", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!live) return;
      if (!response.ok || !result.success) { setError(result.message || "Unable to load the cash accounts."); return; }
      setOptions({ accounts: result.accounts ?? [], branches: result.branches ?? [] });
    }).catch(() => { if (live) setError("Unable to load the cash accounts."); });
    return () => { live = false; };
  }, []);
  return <div className="grid gap-3 sm:grid-cols-3">
    <div className="space-y-1"><Label>Paid from (cash account)</Label>
      <select aria-label="Cash account" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={value.account} onChange={(event) => onChange({ ...value, account: event.target.value })}>
        <option value="">Select account</option>
        {options.accounts.filter((account) => account.status === "active").map((account) => <option key={account.id}>{account.name}</option>)}
      </select></div>
    <div className="space-y-1"><Label>Charged to branch</Label>
      <SearchSelect aria-label="Branch" className="h-9" placeholder="Search branch" value={value.branch} onValueChange={(branch) => onChange({ ...value, branch })} options={options.branches.map((branch) => ({ value: branch.name, label: branch.name, description: branch.territory }))} /></div>
    <div className="space-y-1"><Label>Date paid</Label><Input type="date" max={manilaToday()} value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value })} /></div>
    {error && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p>}
  </div>;
}
