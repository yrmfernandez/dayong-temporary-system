"use client";

import { ArrowRightLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import type { EmployeeAccount } from "@/lib/member-transfer";

type Candidate = { employeeId: string; name: string; roles: string[]; branches: string[] };
type Loaded = { employee: { id: string; name: string }; accounts: EmployeeAccount[]; candidates: Candidate[] };

/**
 * Transfer members: all or some of one employee's accounts move to another employee (lib/member-transfer.ts). Shown on
 * Employees to Administrators and HR Officers. Accounts in branches the new employee is not assigned to stay put.
 */
export function BulkMemberTransfer({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/transfer?employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the members."); return result as Loaded; })
      .then((loaded) => { if (!cancelled) setData(loaded); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the members."); });
    return () => { cancelled = true; };
  }, [employeeId]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? accounts.filter((account) => [account.memberName, account.memberNumber, account.program, account.branch].some((value) => value.toLowerCase().includes(term))) : accounts;
  }, [accounts, search]);
  const chosen = accounts.filter((account) => selected.has(account.enrollmentId));
  const candidate = data?.candidates.find((item) => item.employeeId === target);
  const covered = new Set((candidate?.branches ?? []).map((branch) => branch.toLowerCase()));
  const outside = candidate ? chosen.filter((account) => !covered.has(account.branch.toLowerCase())) : [];
  const outsideBranches = [...new Set(outside.map((account) => account.branch))];
  const allShown = shown.length > 0 && shown.every((account) => selected.has(account.enrollmentId));
  const toggleAll = () => setSelected((current) => { const next = new Set(current); for (const account of shown) { if (allShown) next.delete(account.enrollmentId); else next.add(account.enrollmentId); } return next; });
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function transfer() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromEmployeeId: employeeId, enrollmentIds: [...selected], toEmployeeId: target, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to transfer the members.");
      const { from, to, moved, skipped } = result.result as { from: string; to: string; moved: number; skipped: Array<{ branch: string; count: number }> };
      onDone(`${moved} account${moved === 1 ? "" : "s"} moved from ${from} to ${to}. Future collections belong to ${to}.${skipped.length ? ` Not moved (${to} is not assigned to the branch): ${skipped.map((item) => `${item.branch} ${item.count}`).join(", ")}.` : ""}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to transfer the members."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><ArrowRightLeft className="size-4" />Transfer members{data ? ` of ${data.employee.name}` : ""}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!data && !error && <p className="text-muted-foreground">Loading their members...</p>}
      {data && !accounts.length && <p className="text-muted-foreground">{data.employee.name} has no member accounts.</p>}
      {data && accounts.length > 0 && <>
        <p className="text-muted-foreground">{accounts.length} account{accounts.length === 1 ? "" : "s"}. Choose all or some, then the employee they go to. Past collections stay with {data.employee.name}; future collections belong to the new MAS.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Input className="h-9 max-w-xs" placeholder="Search member, PH number, program, branch" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={allShown} onChange={toggleAll} />{search ? `Select all shown (${shown.length})` : `Select all (${accounts.length})`}</label>
          <span className="font-medium">{selected.size} selected</span>
        </div>
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-muted text-xs"><tr><th className="w-10 p-2" /><th className="p-2">Member</th><th className="p-2">Program</th><th className="p-2">Branch</th><th className="p-2">Payment status</th></tr></thead>
            <tbody>{shown.map((account) => (
              <tr key={account.enrollmentId} className="border-t">
                <td className="p-2"><input type="checkbox" aria-label={`Select ${account.memberName}`} checked={selected.has(account.enrollmentId)} onChange={() => toggle(account.enrollmentId)} /></td>
                <td className="p-2">{account.memberName || "—"}<span className="block text-xs text-muted-foreground">{account.memberNumber}</span></td>
                <td className="p-2">{account.program}</td>
                <td className="p-2">{account.branch}</td>
                <td className="p-2">{account.accountStatus || "—"}{account.status && account.status.toLowerCase() !== "active" ? ` · ${account.status}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1"><Label>Transfer to *</Label>
            <SearchSelect aria-label="Transfer to" className="h-9" placeholder="Search employee or MAS" value={target} onValueChange={setTarget}
              options={data.candidates.map((item) => ({ value: item.employeeId, label: item.name, description: `${item.employeeId} · ${item.roles.join(", ") || "No role"} · ${item.branches.join(", ") || "No branch"}` }))} /></div>
          <div className="space-y-1"><Label htmlFor={`transfer-reason-${employeeId}`}>Reason *</Label><Input id={`transfer-reason-${employeeId}`} maxLength={300} placeholder="e.g. MAS resigned; accounts reassigned" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          <Button type="button" disabled={busy || !selected.size || !target || reason.trim().length < 3 || outside.length === chosen.length} onClick={() => void transfer()}>{busy ? "Transferring..." : `Transfer ${chosen.length - outside.length || ""}`.trim()}</Button>
        </div>
        {candidate && outside.length > 0 && (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {candidate.name} is not assigned to {outsideBranches.join(", ")}, so {outside.length} of the selected account{outside.length === 1 ? "" : "s"} will stay with {data.employee.name}. Collections need the MAS to be assigned to the account&apos;s branch: add the branch to {candidate.name} in Employees → Edit first to move them too.
          </p>
        )}
      </>}
      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
