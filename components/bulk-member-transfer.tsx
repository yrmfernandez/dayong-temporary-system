"use client";

import { ArrowRightLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { branchChoiceReady, branchesOutside, noBranchChoice, TransferBranchChoice, type BranchChoice } from "@/components/transfer-branch-choice";
import type { EmployeeAccount } from "@/lib/member-transfer";

type Candidate = { employeeId: string; name: string; roles: string[]; branches: string[] };
type Loaded = { employee: { id: string; name: string }; accounts: EmployeeAccount[]; candidates: Candidate[]; branches?: string[]; masBranches?: string[] };

/**
 * Transfer members: all or some of one employee's accounts move to another employee (lib/member-transfer.ts). Shown on
 * Employees to Administrators and HR Officers. The new employee may be from any branch (October 14, 2026): accounts in
 * branches they are not assigned to keep their branch (assigning them) or move to their branch, as chosen.
 * mode "branch" (October 17, 2026, Edit / Corrections → Move between branches): the chosen accounts stay with this
 * employee and move to another branch; the employee is assigned to that branch if needed.
 */
export function BulkMemberTransfer({ employeeId, mode = "mas", onClose, onDone }: { employeeId: string; mode?: "mas" | "branch"; onClose: () => void; onDone: (message: string) => void }) {
  const byBranch = mode === "branch";
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [branchChoice, setBranchChoice] = useState<BranchChoice>(noBranchChoice);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/transfer?employeeId=${encodeURIComponent(employeeId)}${byBranch ? "&branches=1" : ""}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the members."); return result as Loaded; })
      .then((loaded) => { if (!cancelled) setData(loaded); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the members."); });
    return () => { cancelled = true; };
  }, [employeeId, byBranch]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? accounts.filter((account) => [account.memberName, account.memberNumber, account.program, account.branch].some((value) => value.toLowerCase().includes(term))) : accounts;
  }, [accounts, search]);
  const chosen = accounts.filter((account) => selected.has(account.enrollmentId));
  const candidate = data?.candidates.find((item) => item.employeeId === target);
  const outsideBranches = candidate ? branchesOutside(chosen.map((account) => account.branch), candidate.branches) : [];
  const outsideCount = chosen.filter((account) => outsideBranches.includes(account.branch)).length;
  const inMasBranch = (name: string) => (data?.masBranches ?? []).some((item) => item.toLowerCase() === name.toLowerCase());
  const allShown = shown.length > 0 && shown.every((account) => selected.has(account.enrollmentId));
  const toggleAll = () => setSelected((current) => { const next = new Set(current); for (const account of shown) { if (allShown) next.delete(account.enrollmentId); else next.add(account.enrollmentId); } return next; });
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function moveBranch() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "branch", enrollmentIds: [...selected], branch: target, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to move the accounts.");
      const { to, moved, skipped, assigned } = result.change as { to: string; moved: number; skipped: number; assigned: string[] };
      onDone(`${moved} account${moved === 1 ? "" : "s"} of ${data?.employee.name ?? "the MAS"} moved to branch ${to}; the MAS stays the same. Future collections are recorded in ${to}.${assigned.length ? ` ${assigned.join(", ")} is now assigned to ${to}.` : ""}${skipped ? ` ${skipped} already in ${to} were left as they are.` : ""}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to move the accounts."); }
    finally { setBusy(false); }
  }

  async function transfer() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromEmployeeId: employeeId, enrollmentIds: [...selected], toEmployeeId: target, reason, ...branchChoice }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to transfer the members.");
      const { from, to, moved, assigned, movedBranch, moveTo } = result.result as { from: string; to: string; moved: number; assigned: string[]; movedBranch: number; moveTo: string };
      onDone(`${moved} account${moved === 1 ? "" : "s"} moved from ${from} to ${to}. Future collections belong to ${to}.${assigned.length ? ` ${to} is now assigned to ${assigned.join(", ")}.` : ""}${movedBranch ? ` ${movedBranch} account${movedBranch === 1 ? "" : "s"} moved to branch ${moveTo}.` : ""}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to transfer the members."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><ArrowRightLeft className="size-4" />{byBranch ? "Move to another branch" : "Transfer members"}{data ? ` of ${data.employee.name}` : ""}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!data && !error && <p className="text-muted-foreground">Loading their members...</p>}
      {data && !accounts.length && <p className="text-muted-foreground">{data.employee.name} has no member accounts.</p>}
      {data && accounts.length > 0 && <>
        <p className="text-muted-foreground">{accounts.length} account{accounts.length === 1 ? "" : "s"}. {byBranch ? `Choose all or some, then the branch they go to. They stay with ${data.employee.name}; past collections stay under their old branch, future collections are recorded in the new one.` : `Choose all or some, then the employee they go to. Past collections stay with ${data.employee.name}; future collections belong to the new MAS.`}</p>
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
          {byBranch ? <div className="space-y-1"><Label>New branch *</Label>
            <SearchSelect aria-label="New branch" className="h-9" placeholder="Search branch" value={target} onValueChange={setTarget}
              options={(data.branches ?? []).map((name) => ({ value: name, label: name, description: inMasBranch(name) ? `${data.employee.name} is assigned here` : "" }))} /></div>
          : <div className="space-y-1"><Label>Transfer to *</Label>
            <SearchSelect aria-label="Transfer to" className="h-9" placeholder="Search employee or MAS, any branch" value={target} onValueChange={(value) => { setTarget(value); setBranchChoice(noBranchChoice); }}
              options={data.candidates.map((item) => ({ value: item.employeeId, label: item.name, description: `${item.employeeId} · ${item.roles.join(", ") || "No role"} · ${item.branches.join(", ") || "No branch"}` }))} /></div>}
          <div className="space-y-1"><Label htmlFor={`transfer-reason-${employeeId}`}>Reason *</Label><Input id={`transfer-reason-${employeeId}`} maxLength={300} placeholder={byBranch ? "e.g. MAS now covers the new branch" : "e.g. MAS resigned; accounts reassigned"} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          {byBranch ? <Button type="button" disabled={busy || !selected.size || !target || reason.trim().length < 3} onClick={() => void moveBranch()}>{busy ? "Moving..." : `Move ${chosen.length || ""}`.trim()}</Button>
            : <Button type="button" disabled={busy || !selected.size || !target || reason.trim().length < 3 || !branchChoiceReady(outsideBranches, branchChoice)} onClick={() => void transfer()}>{busy ? "Transferring..." : `Transfer ${chosen.length || ""}`.trim()}</Button>}
        </div>
        {byBranch && target && !inMasBranch(target) && <p className="text-xs text-amber-700 dark:text-amber-400">{data.employee.name} is not assigned to {target} yet and will be assigned to it, so collections and clearing work there.</p>}
        {!byBranch && candidate && <TransferBranchChoice name={candidate.name} outside={outsideBranches} count={outsideCount} targetBranches={candidate.branches} value={branchChoice} onChange={setBranchChoice} />}
      </>}
      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
