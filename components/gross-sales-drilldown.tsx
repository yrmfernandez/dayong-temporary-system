"use client";

import { ChevronDown, Download, PhilippinePeso, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Change } from "@/components/executive-charts";
import { Input } from "@/components/ui/input";
import type { GrossSalesBreakdown, GrossSalesEntry } from "@/lib/gross-sales";

type Page = { totals: GrossSalesBreakdown["totals"]; branches: GrossSalesBreakdown["branches"]; filtered: { count: number; total: number }; entries: GrossSalesEntry[] };

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const longDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric" });

/**
 * The Gross Sales tile of the executive and finance dashboards. Clicking it opens, below the tiles, every New Sale and
 * Collection that makes up the figure (/api/dashboard/gross-sales, same rule as the dashboard), with totals by type and
 * branch, a search, and a CSV download. The server searches and pages (200 at a time), so a year of entries is never
 * sent at once. Placed inside the tile grid; the panel spans the whole row.
 */
export function GrossSalesDrilldown({ label, value, note, change, from, to }: { label: string; value: number; note: string; change?: number | null; from: string; to: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | GrossSalesEntry["kind"]>("");
  const [branch, setBranch] = useState("");
  // The search asks the server once typing pauses.
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(timer); }, [search]);
  const params = (offset = 0, format = "") => new URLSearchParams({ from, to, ...(query && { q: query }), ...(kind && { kind }), ...(branch && { branch }), ...(offset && { offset: String(offset) }), ...(format && { format }) }).toString();

  async function load(offset: number) {
    const response = await fetch(`/api/dashboard/gross-sales?${params(offset)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the breakdown.");
    return result as Page;
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the request this effect starts
    setLoading(true); setError("");
    load(0).then((page) => { if (!cancelled) setData(page); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the breakdown."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads the filters listed here
  }, [open, from, to, query, kind, branch]);
  async function showMore() {
    if (!data) return;
    setLoading(true);
    try { const page = await load(data.entries.length); setData({ ...page, entries: [...data.entries, ...page.entries] }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load more entries."); }
    finally { setLoading(false); }
  }
  const filtered = data?.entries ?? [];
  const matches = data ? Math.round(data.totals.gross * 100) === Math.round(value * 100) : true;
  const filtering = Boolean(query || kind || branch);

  return <>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="block h-full rounded-[1.25rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div data-slot="card" className={`tone-brand relative h-full overflow-hidden rounded-[1.25rem] p-4 transition-transform hover:-translate-y-0.5 ${open ? "ring-2 ring-primary/40" : ""}`}>
        <span className="tone-bar absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden />
        <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{label}</p><span className="tone-soft flex size-9 shrink-0 items-center justify-center rounded-xl"><PhilippinePeso className="size-4.5" /></span></div>
        <p className="mt-1 break-words text-xl font-bold tracking-tight text-foreground tabular-nums sm:text-2xl">{money(value)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{change !== undefined && <Change value={change} />}<span>{note}</span></p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary print:hidden">{open ? "Hide the entries" : "See the entries"}<ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></p>
      </div>
    </button>

    {open && <section aria-label="Gross Sales breakdown" className="col-span-full space-y-4 rounded-[1.25rem] border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">What makes up Gross Sales</h3><p className="text-xs text-muted-foreground">{longDate(from)} – {longDate(to)} · New Sales (amount paid + penalty) by sale date, plus posted Collections by OR date.</p></div>
        <div className="flex gap-2">
          {data && <a href={`/api/dashboard/gross-sales?${params(0, "csv")}`} download className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"><Download className="size-4" />CSV{filtering ? " (filtered)" : ""}</a>}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close the breakdown" className="rounded-lg border p-1.5 hover:bg-muted"><X className="size-4" /></button>
        </div>
      </div>
      {loading && !data && <p className="text-sm text-muted-foreground">Loading the entries…</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Sum label="New Sales" value={data.totals.newSales} detail={`${data.totals.newSaleCount.toLocaleString("en-PH")} sales${data.totals.penalties ? ` · incl. ${money(data.totals.penalties)} penalties` : ""}`} active={kind === "New Sale"} onClick={() => setKind(kind === "New Sale" ? "" : "New Sale")} />
          <Sum label="Collections" value={data.totals.collections} detail={`${data.totals.collectionCount.toLocaleString("en-PH")} posted payments`} active={kind === "Collection"} onClick={() => setKind(kind === "Collection" ? "" : "Collection")} />
          <div className="rounded-xl border bg-primary/5 p-3"><p className="text-xs text-muted-foreground">= Gross Sales</p><p className="text-lg font-bold tabular-nums">{money(data.totals.gross)}</p><p className={`text-xs ${matches ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{matches ? "Matches the dashboard" : `Dashboard shows ${money(value)}: entries changed since it loaded; reload the page`}</p></div>
        </div>

        {data.branches.length > 1 && <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-semibold">By branch ({data.branches.length})</summary>
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Branch</th><th className="py-1.5 pr-3 text-right">New Sales</th><th className="py-1.5 pr-3 text-right">Collections</th><th className="py-1.5 text-right">Total</th></tr></thead>
            <tbody>{data.branches.map((row) => <tr key={row.branch} className={`cursor-pointer border-b last:border-0 hover:bg-muted/50 ${branch === row.branch ? "bg-primary/5" : ""}`} onClick={() => setBranch(branch === row.branch ? "" : row.branch)}>
              <td className="py-1.5 pr-3 font-medium">{row.branch}</td><td className="py-1.5 pr-3 text-right tabular-nums">{money(row.newSales)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{money(row.collections)}</td><td className="py-1.5 text-right font-semibold tabular-nums">{money(row.total)}</td></tr>)}</tbody></table></div>
          <p className="mt-1 text-xs text-muted-foreground">Click a branch to list only its entries.</p>
        </details>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input type="search" aria-label="Search entries" className="pl-9" placeholder="Search OR / application no., member, program, MAS" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {(kind || branch || search) && <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => { setKind(""); setBranch(""); setSearch(""); }}>Clear filters</button>}
          <p className="text-sm text-muted-foreground tabular-nums">{data.filtered.count.toLocaleString("en-PH")} entries · {money(data.filtered.total)}{kind ? ` · ${kind}s` : ""}{branch ? ` · ${branch}` : ""}</p>
        </div>

        <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["Date", "Type", "OR / App no.", "Member", "Program", "Branch", "MAS / accountable", "Amount"].map((heading) => <th key={heading} className={`px-3 py-2 ${heading === "Amount" ? "text-right" : ""}`}>{heading}</th>)}</tr></thead>
          <tbody>{filtered.map((row) => <tr key={`${row.kind}-${row.id}`} className="border-t">
            <td className="whitespace-nowrap px-3 py-2 tabular-nums">{shortDate(row.date)}</td>
            <td className="px-3 py-2"><span className={`tone-chip ${row.kind === "New Sale" ? "tone-orange" : "tone-teal"} rounded-full px-2 py-0.5 text-[11px] font-semibold`}>{row.kind}</span></td>
            <td className={`px-3 py-2 tabular-nums ${/\((duplicated|need edit)/i.test(row.reference) ? "text-amber-700 dark:text-amber-400" : ""}`}>{row.reference || "—"}</td>
            <td className="px-3 py-2"><span className="font-medium">{row.memberName || "—"}</span>{row.memberNumber && <span className="block text-xs text-muted-foreground">{row.memberNumber}</span>}</td>
            <td className="px-3 py-2">{row.program || "—"}</td><td className="px-3 py-2">{row.branch || "—"}</td><td className="px-3 py-2">{row.person || "—"}</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(row.amount)}{row.penalty > 0 && <span className="block text-xs font-normal text-muted-foreground">incl. {money(row.penalty)} penalty</span>}</td>
          </tr>)}
          {!filtered.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No entries match.</td></tr>}</tbody>
        </table></div>
        {data.filtered.count > filtered.length && <button type="button" disabled={loading} onClick={() => void showMore()} className="w-full rounded-lg border py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">{loading ? "Loading…" : `Show more (${(data.filtered.count - filtered.length).toLocaleString("en-PH")} left)`}</button>}
      </>}
    </section>}
  </>;
}

function Sum({ label, value, detail, active, onClick }: { label: string; value: number; detail: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 ${active ? "border-primary bg-primary/5" : ""}`}>
    <p className="text-xs text-muted-foreground">{label}{active ? " · showing only these" : ""}</p><p className="text-lg font-bold tabular-nums">{money(value)}</p><p className="text-xs text-muted-foreground">{detail}</p>
  </button>;
}
