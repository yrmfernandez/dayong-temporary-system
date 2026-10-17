"use client";

import Link from "next/link";
import { ArrowRightLeft, Building2, Pencil, Search, Shuffle, Trash2, Wrench } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { AdminDeletePanel } from "@/components/admin-delete";
import { BulkMemberTransfer } from "@/components/bulk-member-transfer";
import { EntryEditor } from "@/components/entry-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { ProgramTransfer } from "@/app/programs/program-transfer";
import { parseJsonResponse } from "@/lib/api-response";
import type { FoundEntry, SearchKind } from "@/lib/entry-search";

type Result = { success: boolean; message?: string; entries: FoundEntry[]; limit: number; canDelete: boolean };
type Options = { employees: Array<{ id: string; name: string; branch: string; roles: string[]; status: string }>; programs: Array<{ id: string; name: string; code: string; rate: number; status: string }> };
type Tab = "entries" | "mas" | "branches" | "programs" | "more";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const KINDS: Array<[SearchKind, string]> = [["all", "New Sales and Collections"], ["New Sale", "New Sales"], ["Collection", "Collections"]];
const TABS: Array<[Tab, string, typeof Pencil]> = [["entries", "Entries", Pencil], ["mas", "Move between MAS", ArrowRightLeft], ["branches", "Move between branches", Building2], ["programs", "Move between programs", Shuffle], ["more", "Other corrections", Wrench]];

/**
 * Edit / Corrections (owner, October 15, 2026): one place for IT and Administrators to change data.
 *   Entries: search New Sales and Collections (remitted too) and edit everything about one (lib/entry-edit.ts), or
 *     delete it (Administrators, lib/admin-delete.ts).
 *   Move between MAS: an employee's members to another MAS (lib/member-transfer.ts).
 *   Move between branches (October 17, 2026): a MAS's members to another branch, same MAS (lib/member-transfer.ts).
 *   Move between programs: a program's accounts to another program with the same pay (lib/program-transfer.ts).
 *   Other corrections: where the rest is changed (member details, employee IDs, data problems, history).
 * Every change needs a reason and is kept in the Audit Log and Record Corrections.
 */
export default function EditCorrectionsPage() {
  const [tab, setTab] = useState<Tab>("entries");
  const [message, setMessage] = useState("");
  return <section className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold">Edit / Corrections</h1>
      <p className="text-sm text-muted-foreground">Change data that was entered wrong: New Sales and Collections (remitted ones too), which MAS has which members, and which program an account belongs to. Every change needs a reason and is kept in the Audit Log and Record Corrections.</p>
    </div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Kinds of correction">
      {TABS.map(([value, label, Icon]) => <Button key={value} type="button" role="tab" aria-selected={tab === value} variant={tab === value ? "default" : "outline"} onClick={() => { setTab(value); setMessage(""); }}><Icon className="size-4" />{label}</Button>)}
    </div>
    {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p>}
    {tab === "entries" && <EntriesTab />}
    {tab === "mas" && <MoveBetweenMas onDone={setMessage} />}
    {tab === "branches" && <MoveBetweenMas key="branches" byBranch onDone={setMessage} />}
    {tab === "programs" && <MoveBetweenPrograms onDone={setMessage} />}
    {tab === "more" && <OtherCorrections />}
  </section>;
}

function EntriesTab() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [result, setResult] = useState<Result | null>(null);
  const [searched, setSearched] = useState({ query: "", kind: "all" as SearchKind });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [saved, setSaved] = useState<{ key: string; message: string } | null>(null);

  async function search(next = { query, kind }) {
    if (next.query.trim().length < 2) { setError("Type at least 2 characters to search."); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/entry-corrections?${new URLSearchParams({ q: next.query.trim(), kind: next.kind })}`, { cache: "no-store" });
      const data = await parseJsonResponse<Result>(response);
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to search entries.");
      setResult(data); setSearched(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to search entries."); }
    finally { setLoading(false); }
  }

  const key = (entry: FoundEntry) => `${entry.kind}:${entry.id}`;
  const done = (entry: FoundEntry) => (text: string) => { setOpen(""); setSaved({ key: key(entry), message: text }); void search(searched); };
  const capped = result && (result.entries.filter((entry) => entry.kind === "New Sale").length >= result.limit || result.entries.filter((entry) => entry.kind === "Collection").length >= result.limit);

  return <div className="space-y-4">
    <Card><CardContent className="p-4">
      <form className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="space-y-1 text-sm">Search
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="OR number, application number, member number or name, record ID" autoFocus /></div>
        </label>
        <label className="space-y-1 text-sm">In
          <select className="w-full rounded-md border bg-background p-2" value={kind} onChange={(event) => setKind(event.target.value as SearchKind)}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <Button type="submit" disabled={loading}>{loading ? "Searching..." : "Search"}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Edit changes anything about an entry: the program or account (for a member with several), OR and application numbers, dates, amount, months paid, Date Remitted, method and notes.</p>
    </CardContent></Card>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

    {result && <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{result.entries.length} entr{result.entries.length === 1 ? "y" : "ies"} for “{searched.query}”.{capped ? ` Showing the newest ${result.limit} of a kind; type more of the number or name to narrow it.` : ""}</p>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-muted"><tr>{["Type", "Record", "Member", "Program · Branch", "MAS / Collector", "OR number", "OR date", "Application no.", "Amount", "Remittance", "Encoded by", ""].map((heading, index) => <th key={index} className="p-2">{heading}</th>)}</tr></thead>
          <tbody>
            {result.entries.map((entry) => <Fragment key={key(entry)}>
              <tr className="border-t align-top">
                <td className="whitespace-nowrap p-2">{entry.kind}</td>
                <td className="p-2 font-mono text-xs">{entry.id}</td>
                <td className="p-2"><span className="font-medium">{entry.memberName || "—"}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                <td className="p-2">{entry.program}<span className="block text-xs text-muted-foreground">{entry.branch}</span></td>
                <td className="p-2">{entry.person || "—"}</td>
                <td className="p-2 font-medium">{entry.orNumber || "—"}</td>
                <td className="whitespace-nowrap p-2">{entry.orDate || "—"}</td>
                <td className="p-2">{entry.kind === "New Sale" ? entry.applicationNumber || "—" : ""}</td>
                <td className="p-2 text-right tabular-nums">{money(entry.amount)}</td>
                <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.onRemittance ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>{entry.remittanceStatus || "Outstanding"}</span>{entry.remittanceId && <span className="block font-mono text-xs text-muted-foreground">{entry.remittanceId}</span>}</td>
                <td className="p-2 text-xs">{entry.encodedBy || <span className="text-muted-foreground">Imported</span>}<span className="block text-muted-foreground">{entry.encodedAt}</span></td>
                <td className="p-2"><div className="flex gap-1">
                  <Button type="button" size="sm" variant={open === `edit:${key(entry)}` ? "default" : "outline"} onClick={() => { setSaved(null); setOpen((current) => current === `edit:${key(entry)}` ? "" : `edit:${key(entry)}`); }}><Pencil className="size-4" />Edit</Button>
                  {result.canDelete && <Button type="button" size="sm" variant="outline" className="text-destructive" aria-label={`Delete ${entry.id}`} onClick={() => { setSaved(null); setOpen((current) => current === `delete:${key(entry)}` ? "" : `delete:${key(entry)}`); }}><Trash2 className="size-4" /></Button>}
                </div></td>
              </tr>
              {saved?.key === key(entry) && !open && <tr><td colSpan={12} className="px-2 pb-2"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{saved.message}</p></td></tr>}
              {open === `edit:${key(entry)}` && <tr className="bg-muted/30"><td colSpan={12} className="p-3"><EntryEditor kind={entry.kind} id={entry.id} onCancel={() => setOpen("")} onSaved={done(entry)} /></td></tr>}
              {open === `delete:${key(entry)}` && <tr className="bg-muted/30"><td colSpan={12} className="p-3"><AdminDeletePanel kind={entry.kind === "New Sale" ? "sale" : "collection"} id={entry.id} onCancel={() => setOpen("")} onDeleted={done(entry)} /></td></tr>}
            </Fragment>)}
            {!result.entries.length && <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">No New Sales or Collections match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>}
  </div>;
}

/** The pickers of the Move tabs: every employee and program. */
function useOptions() {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/entry-corrections?options=1", { cache: "no-store", signal: controller.signal })
      .then((response) => parseJsonResponse<Options & { success: boolean; message?: string }>(response))
      .then((result) => { if (!result.success) throw new Error(result.message || "Unable to load the lists."); setOptions(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load the lists."); });
    return () => controller.abort();
  }, []);
  return { options, error };
}

function MoveBetweenMas({ byBranch = false, onDone }: { byBranch?: boolean; onDone: (message: string) => void }) {
  const { options, error } = useOptions();
  const [employeeId, setEmployeeId] = useState("");
  return <Card>
    {byBranch ? <CardHeader><CardTitle>Move members to another branch</CardTitle>
      <p className="text-sm text-muted-foreground">Choose the MAS, tick their members (or all), then choose the branch they go to. The MAS stays the same and is assigned to the new branch if needed. Each account gets a transfer record with the reason. Past collections stay under the old branch; future collections are recorded in the new one.</p></CardHeader>
    : <CardHeader><CardTitle>Move members between MAS</CardTitle>
      <p className="text-sm text-muted-foreground">Choose the MAS the members are under now, tick the members (or all), then choose the MAS they go to. Each account gets a transfer record with the reason. Past collections and cash stay with the MAS who handled them.</p></CardHeader>}
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="max-w-xl space-y-1 text-sm">{byBranch ? "MAS" : "From MAS"}
        <SearchSelect aria-label={byBranch ? "MAS" : "From MAS"} clearable value={employeeId} placeholder={options ? "Search employee name or ID" : "Loading..."} disabled={!options}
          options={(options?.employees ?? []).map((employee) => ({ value: employee.id, label: employee.name, description: `${employee.id}${employee.branch ? ` · ${employee.branch}` : ""}${employee.status !== "active" ? ` · ${employee.status}` : ""}`, keywords: employee.id }))}
          onValueChange={setEmployeeId} />
      </div>
      {employeeId && <BulkMemberTransfer key={employeeId} employeeId={employeeId} mode={byBranch ? "branch" : "mas"} onClose={() => setEmployeeId("")} onDone={(text) => { setEmployeeId(""); onDone(text); }} />}
    </CardContent>
  </Card>;
}

function MoveBetweenPrograms({ onDone }: { onDone: (message: string) => void }) {
  const { options, error } = useOptions();
  const [programId, setProgramId] = useState("");
  return <Card>
    <CardHeader><CardTitle>Move accounts between programs</CardTitle>
      <p className="text-sm text-muted-foreground">Choose the program the accounts are in now, tick the accounts (or all), then the program they go to. Only programs with the same monthly pay can take them; a member who already has the other program is merged into it. For one wrong entry, use Edit on the Entries tab instead.</p></CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="max-w-xl space-y-1 text-sm">From program
        <SearchSelect aria-label="From program" clearable value={programId} placeholder={options ? "Search program" : "Loading..."} disabled={!options}
          options={(options?.programs ?? []).map((program) => ({ value: program.id, label: program.name, description: `${program.code ? `${program.code} · ` : ""}₱${program.rate}/month${program.status === "inactive" ? " · inactive" : ""}`, keywords: program.code }))}
          onValueChange={setProgramId} />
      </div>
      {programId && <ProgramTransfer key={programId} programId={programId} onClose={() => setProgramId("")} onDone={(text) => { setProgramId(""); onDone(text); }} />}
    </CardContent>
  </Card>;
}

function OtherCorrections() {
  const places: Array<[string, string, string]> = [
    ["/members", "Members", "Edit a member's details (name, birthdate, contact, claimant), move one account to another MAS or another branch, or delete a member entered by mistake."],
    ["/employees", "Employees", "Change an Employee ID (every record that uses it follows), branches and roles."],
    ["/exceptions", "Exceptions", "Lists of data problems to fix: dates, amounts, duplicate numbers, missing branch letters."],
    ["/remittances", "Remittances", "Approve, return or delete remittance slips."],
    ["/history", "Audit Log", "Every change, with who made it, and the Record Corrections with their reasons."],
  ];
  return <Card>
    <CardHeader><CardTitle>Other corrections</CardTitle><p className="text-sm text-muted-foreground">Changes made on their own pages.</p></CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2">
      {places.map(([href, label, detail]) => <Link key={href} href={href} className="rounded-lg border p-3 hover:border-primary">
        <p className="font-semibold text-primary">{label}</p><p className="text-sm text-muted-foreground">{detail}</p>
      </Link>)}
    </CardContent>
  </Card>;
}
