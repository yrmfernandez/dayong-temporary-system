"use client";

import { Pencil, Search } from "lucide-react";
import { Fragment, useState } from "react";

import { EntryCorrectionForm } from "@/components/entry-correction-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseJsonResponse } from "@/lib/api-response";
import type { FoundEntry, SearchKind } from "@/lib/entry-search";

type Result = { success: boolean; message?: string; entries: FoundEntry[]; limit: number };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const KINDS: Array<[SearchKind, string]> = [["all", "New Sales and Collections"], ["New Sale", "New Sales"], ["Collection", "Collections"]];

/**
 * Entry Corrections (owner, October 15, 2026): IT and Administrators search New Sales and Collections, remitted ones
 * included, and fix what the Entry Clerk typed wrong (OR number, OR date, application number, notes) with a reason
 * kept in Record Corrections. The amount of a remitted entry stays as remitted (corrected through reconciliation).
 */
export default function EntryCorrectionsPage() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [result, setResult] = useState<Result | null>(null);
  const [searched, setSearched] = useState({ query: "", kind: "all" as SearchKind });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
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
  const capped = result && (result.entries.filter((entry) => entry.kind === "New Sale").length >= result.limit || result.entries.filter((entry) => entry.kind === "Collection").length >= result.limit);

  return <section className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold">Entry Corrections</h1>
      <p className="text-sm text-muted-foreground">Find a New Sale or Collection, even one already remitted, and fix what was typed wrong: OR number, OR date, application number or notes. Every correction needs a reason and is kept in Record Corrections and the Audit Log. The amount of a remitted entry stays as remitted; correct it through reconciliation.</p>
    </div>

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
                <td className="p-2 whitespace-nowrap">{entry.kind}</td>
                <td className="p-2 font-mono text-xs">{entry.id}</td>
                <td className="p-2"><span className="font-medium">{entry.memberName || "—"}</span><span className="block text-xs text-muted-foreground">{entry.memberNumber}</span></td>
                <td className="p-2">{entry.program}<span className="block text-xs text-muted-foreground">{entry.branch}</span></td>
                <td className="p-2">{entry.person || "—"}</td>
                <td className="p-2 font-medium">{entry.orNumber || "—"}</td>
                <td className="p-2 whitespace-nowrap">{entry.orDate || "—"}</td>
                <td className="p-2">{entry.kind === "New Sale" ? entry.applicationNumber || "—" : ""}</td>
                <td className="p-2 text-right tabular-nums">{money(entry.amount)}</td>
                <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.onRemittance ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>{entry.remittanceStatus || "Outstanding"}</span>{entry.remittanceId && <span className="block font-mono text-xs text-muted-foreground">{entry.remittanceId}</span>}</td>
                <td className="p-2 text-xs">{entry.encodedBy || <span className="text-muted-foreground">Imported</span>}<span className="block text-muted-foreground">{entry.encodedAt}</span></td>
                <td className="p-2"><Button type="button" size="sm" variant="outline" onClick={() => { setSaved(null); setEditing((current) => current === key(entry) ? "" : key(entry)); }}><Pencil className="size-4" />Correct</Button></td>
              </tr>
              {saved?.key === key(entry) && editing !== key(entry) && <tr><td colSpan={12} className="px-2 pb-2"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{saved.message}</p></td></tr>}
              {editing === key(entry) && <tr className="bg-muted/30"><td colSpan={12} className="p-3">
                <EntryCorrectionForm entry={entry} endpoint="/api/entry-corrections" onCancel={() => setEditing("")} onSaved={(message) => { setEditing(""); setSaved({ key: key(entry), message }); void search(searched); }} />
              </td></tr>}
            </Fragment>)}
            {!result.entries.length && <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">No New Sales or Collections match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}
