"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { parseJsonResponse } from "@/lib/api-response";
import type { TransferAccount } from "@/lib/program-transfer";

type Options = { program: { id: string; name: string; code: string; rate: number; flexible: boolean }; accounts: TransferAccount[]; targets: Array<{ id: string; name: string; code: string; rate: number; status: string; accounts: number }> };
const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * Programs → Transfer members (administrators; lib/program-transfer.ts): move all of a program's accounts, or the
 * ticked ones, to another program with the same monthly pay. A member who already has an account there is merged into
 * it; two accounts that paid the same month are left. Optionally delete the program once it is empty.
 */
export function ProgramTransfer({ programId, onClose, onDone }: { programId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [removeWhenEmpty, setRemoveWhenEmpty] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<Array<{ enrollmentId: string; why: string }>>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/programs/transfer?program=${encodeURIComponent(programId)}`, { cache: "no-store" });
        const result = await parseJsonResponse<Options & { success: boolean; message?: string }>(response);
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the program.");
        if (active) { setOptions(result); setSelected(result.accounts.map((account) => account.enrollmentId)); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Unable to load the program."); }
    })();
    return () => { active = false; };
  }, [programId]);

  const term = search.trim().toLowerCase();
  const shown = useMemo(() => (options?.accounts ?? []).filter((account) => !term || [account.memberName, account.memberNumber, account.branch, account.mas, account.enrollmentId].some((value) => value.toLowerCase().includes(term))), [options, term]);
  const all = Boolean(options) && selected.length === options!.accounts.length;
  const targetProgram = options?.targets.find((item) => item.id === target);

  const transfer = async () => {
    if (!options || !targetProgram) return;
    const count = selected.length;
    if (!window.confirm(`Move ${all ? `all ${count}` : count} account${count === 1 ? "" : "s"} from ${options.program.name} to ${targetProgram.name}?${all && removeWhenEmpty ? ` ${options.program.name} will then be deleted (or set inactive if anything still uses it).` : ""}`)) return;
    setBusy(true); setError(""); setLeft([]);
    try {
      const response = await fetch("/api/programs/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: options.program.id, to: target, all, enrollmentIds: all ? [] : selected, removeWhenEmpty: all && removeWhenEmpty, reason }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string; left?: Array<{ enrollmentId: string; why: string }> }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to move the accounts.");
      if (result.left?.length) setLeft(result.left);
      onDone(result.message || "Moved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to move the accounts."); }
    finally { setBusy(false); }
  };

  if (!options) return <div className="space-y-2 text-sm">{error ? <p className="text-red-700">{error}</p> : <p className="text-muted-foreground">Loading accounts...</p>}<Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Transfer members of {options.program.name}</p>
          <p className="text-xs text-muted-foreground">{options.accounts.length} account(s) · {money(options.program.rate)} a month{options.program.flexible ? " (flexible)" : ""}. Only programs with the same monthly pay are listed. A member who already has an account in the target program is merged into it (payments renumbered by month); two accounts that paid the same month are left as they are.</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Move to *<SearchSelect aria-label="Move to program" className="mt-1 h-9" placeholder={options.targets.length ? "Choose a program with the same pay" : "No other program has the same pay"} value={target} onValueChange={setTarget} options={options.targets.map((item) => ({ value: item.id, label: item.name, description: `${item.id}${item.code && item.code !== item.name ? ` · ${item.code}` : ""} · ${money(item.rate)} · ${item.accounts} account(s)${item.status !== "active" ? ` · ${item.status}` : ""}` }))} /></label>
        <label className="text-sm">Reason *<input className={fieldClass} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. D-300 (NEW) is the same plan as D-300 (Bracketing)" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(event) => setSelected(event.target.checked ? options.accounts.map((account) => account.enrollmentId) : [])} />All {options.accounts.length} account(s)</label>
        <span className="text-muted-foreground">{selected.length} selected</span>
        {all && <label className="flex items-center gap-2"><input type="checkbox" checked={removeWhenEmpty} onChange={(event) => setRemoveWhenEmpty(event.target.checked)} />Delete {options.program.name} once it is empty</label>}
        <input className="ml-auto h-8 w-60 rounded-md border bg-background px-2 text-sm" placeholder="Search member, PH number, branch, MAS" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted"><tr><th className="p-2"><span className="sr-only">Select</span></th>{["Member", "Branch / MAS", "DOI", "Status", "Payments"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody>
            {shown.map((account) => <tr key={account.enrollmentId} className="border-t">
              <td className="p-2"><input type="checkbox" aria-label={`Select ${account.memberName || account.enrollmentId}`} checked={selected.includes(account.enrollmentId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, account.enrollmentId] : current.filter((id) => id !== account.enrollmentId))} /></td>
              <td className="p-2">{account.memberName || "—"}<span className="block text-xs text-muted-foreground">{account.memberNumber} · {account.enrollmentId}</span></td>
              <td className="p-2">{account.branch || "—"}<span className="block text-xs text-muted-foreground">{account.mas || "—"}</span></td>
              <td className="p-2">{account.doi || "—"}</td>
              <td className="p-2">{account.status || "—"}</td>
              <td className="p-2">{account.payments}</td>
            </tr>)}
            {!shown.length && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{options.accounts.length ? "No account matches the search." : "This program has no accounts."}</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {left.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">Left as they are ({left.length}):</p><ul className="mt-1 list-disc pl-5">{left.map((item) => <li key={item.enrollmentId}>{item.enrollmentId}: {item.why}</li>)}</ul></div>}
      <div className="flex gap-2">
        <Button type="button" disabled={busy || !target || !selected.length || reason.trim().length < 3} onClick={() => void transfer()}>{busy ? "Moving..." : `Move ${selected.length} account${selected.length === 1 ? "" : "s"}`}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
