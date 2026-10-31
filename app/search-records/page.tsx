"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SearchCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readApiResponse } from "@/lib/api-response";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { DATE_FIELDS, RECORD_KINDS } from "@/lib/record-search-options";

type Collection = { id: string; orNumber: string; orDate: string; amount: number; memberNumber: string; memberName: string; contact: string; program: string; coverage: string; branch: string; mas: string; collector: string; dateRemitted: string; remittanceStatus: string; status: string; encodedBy: string };
type Sale = { id: string; orNumber: string; orDate: string; applicationNo: string; amount: number; memberNumber: string; memberName: string; contact: string; program: string; doi: string; branch: string; mas: string; dateRemitted: string; remittanceStatus: string; dateCreated: string; encodedBy: string };
type MemberHit = { id: string; number: string; name: string; birthdate: string; contact: string; address: string; claimant: string; claimantContact: string; status: string; programs: string };
type Results = { collections: Collection[]; sales: Sale[]; members: MemberHit[]; more: { collections: boolean; sales: boolean; members: boolean }; limit: number };
const STATUSES = ["Outstanding", "Pending Remittance Approval", "Remitted", "Returned"];
const empty = { kind: "all", q: "", orNumber: "", dateField: "", dateFrom: "", dateTo: "", branch: "", program: "", mas: "", remittanceStatus: "" };
const field = "mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm";
const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const memberLink = (number: string) => `/members?search=${encodeURIComponent(number)}`;
const cell = "p-2 align-top";

/**
 * Search Records (owner, October 31, 2026; lib/record-search.ts): find receipts, New Sales and members by OR number,
 * dates, contact, member, program, branch or MAS, with the filters combined. Members filters people by member dates;
 * this page finds the records themselves.
 */
export default function SearchRecordsPage() {
  const [form, setForm] = useState(empty);
  const [options, setOptions] = useState<{ branches: string[]; programs: Array<{ id: string; name: string }> }>({ branches: [], programs: [] });
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof empty, value: string) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    fetch("/api/search-records?options=1", { cache: "no-store" }).then((response) => response.json()).then((result) => { if (result.success) setOptions({ branches: result.branches, programs: result.programs }); }).catch(() => undefined);
  }, []);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/search-records?${new URLSearchParams(form)}`, { cache: "no-store" });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to search.");
      setResults(result as unknown as Results);
    } catch (failure) { setResults(null); setError(failure instanceof Error ? failure.message : "Unable to search."); }
    finally { setBusy(false); }
  }

  const total = results ? results.collections.length + results.sales.length + results.members.length : 0;
  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-2xl page-hero p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><SearchCheck className="size-6" /></div>
        <div><h1 className="text-2xl font-bold">Search Records</h1><p className="text-sm text-violet-30/80">Find any receipt, New Sale or member: by OR number, a date range, a contact number, a name or PH number, a program, branch or MAS. Combine as many as you need.</p></div></div>
    </header>

    <Card><CardContent className="pt-5">
      <form onSubmit={(event) => void search(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm sm:col-span-2">Anything<input type="search" className={field} value={form.q} onChange={(e) => set("q", e.target.value)} placeholder="Name, PH number, contact number, OR number, address" /></label>
        <label className="text-sm">Look in<select className={field} value={form.kind} onChange={(e) => set("kind", e.target.value)}>{RECORD_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">OR or application number<input className={field} value={form.orNumber} onChange={(e) => set("orNumber", e.target.value)} placeholder="e.g. 24619" /></label>
        <label className="text-sm">Date of<select className={field} value={form.dateField} onChange={(e) => set("dateField", e.target.value)}><option value="">Any date</option>{DATE_FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">From<input type="date" className={field} disabled={!form.dateField} value={form.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} /></label>
        <label className="text-sm">To<input type="date" className={field} disabled={!form.dateField} value={form.dateTo} onChange={(e) => set("dateTo", e.target.value)} /></label>
        <label className="text-sm">Remittance status<select className={field} value={form.remittanceStatus} onChange={(e) => set("remittanceStatus", e.target.value)}><option value="">Any</option>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Branch<select className={field} value={form.branch} onChange={(e) => set("branch", e.target.value)}><option value="">All branches</option>{options.branches.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Program<select className={field} value={form.program} onChange={(e) => set("program", e.target.value)}><option value="">All programs</option>{options.programs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm">MAS<input className={field} value={form.mas} onChange={(e) => set("mas", e.target.value)} placeholder="Part of the name" /></label>
        <div className="flex items-end gap-2"><Button type="submit" disabled={busy}>{busy ? "Searching..." : "Search"}</Button><Button type="button" variant="ghost" onClick={() => { setForm(empty); setResults(null); setError(""); }}>Clear</Button></div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </CardContent></Card>

    {results && <p className="text-sm text-muted-foreground">{total ? `${total} record(s) found.` : "Nothing matches. Try fewer filters or a wider date range."} Kinds without the chosen date (for example members with OR date) are skipped.</p>}

    {results && results.collections.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Collections ({results.collections.length}{results.more.collections ? `, showing the newest ${results.limit}` : ""})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">OR</th><th className="p-2">OR date</th><th className="p-2">Member</th><th className="p-2">Program · coverage</th><th className="p-2 text-right">Amount</th><th className="p-2">Branch · MAS</th><th className="p-2">Remittance</th><th className="p-2">Encoded by</th></tr></thead>
        <tbody>{results.collections.map((row) => <tr key={row.id} className="border-t">
          <td className={`${cell} font-medium`}>{row.orNumber || "—"}{row.status !== "Posted" && <Badge variant="outline" className="ml-1">{row.status}</Badge>}</td>
          <td className={`${cell} tabular-nums`}>{formatDate(row.orDate)}</td>
          <td className={cell}><Link className="text-primary hover:underline" href={memberLink(row.memberNumber)}>{row.memberName}</Link><span className="block text-xs text-muted-foreground">{row.memberNumber}{row.contact ? ` · ${row.contact}` : ""}</span></td>
          <td className={cell}>{row.program}<span className="block text-xs text-muted-foreground">{row.coverage}</span></td>
          <td className={`${cell} text-right tabular-nums`}>{peso(row.amount)}</td>
          <td className={cell}>{row.branch}<span className="block text-xs text-muted-foreground">{row.mas}{row.collector ? ` · Collector ${row.collector}` : ""}</span></td>
          <td className={cell}>{row.remittanceStatus || "—"}<span className="block text-xs text-muted-foreground">{row.dateRemitted ? formatDate(row.dateRemitted) : ""}</span></td>
          <td className={`${cell} text-xs text-muted-foreground`}>{row.encodedBy}</td>
        </tr>)}</tbody></table></CardContent></Card>}

    {results && results.sales.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">New Sales ({results.sales.length}{results.more.sales ? `, showing the newest ${results.limit}` : ""})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">OR · application</th><th className="p-2">Encoded</th><th className="p-2">Member</th><th className="p-2">Program · DOI</th><th className="p-2 text-right">Amount</th><th className="p-2">Branch · MAS</th><th className="p-2">Remittance</th><th className="p-2">Encoded by</th></tr></thead>
        <tbody>{results.sales.map((row) => <tr key={row.id} className="border-t">
          <td className={`${cell} font-medium`}>{row.orNumber || "—"}<span className="block text-xs font-normal text-muted-foreground">{row.applicationNo}{row.orDate ? ` · OR ${formatDate(row.orDate)}` : ""}</span></td>
          <td className={`${cell} tabular-nums`}>{formatDateTime(row.dateCreated)}</td>
          <td className={cell}><Link className="text-primary hover:underline" href={memberLink(row.memberNumber)}>{row.memberName}</Link><span className="block text-xs text-muted-foreground">{row.memberNumber}{row.contact ? ` · ${row.contact}` : ""}</span></td>
          <td className={cell}>{row.program}<span className="block text-xs text-muted-foreground">DOI {formatDate(row.doi)}</span></td>
          <td className={`${cell} text-right tabular-nums`}>{peso(row.amount)}</td>
          <td className={cell}>{row.branch}<span className="block text-xs text-muted-foreground">{row.mas}</span></td>
          <td className={cell}>{row.remittanceStatus || "—"}<span className="block text-xs text-muted-foreground">{row.dateRemitted ? formatDate(row.dateRemitted) : ""}</span></td>
          <td className={`${cell} text-xs text-muted-foreground`}>{row.encodedBy}</td>
        </tr>)}</tbody></table></CardContent></Card>}

    {results && results.members.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Members and contacts ({results.members.length}{results.more.members ? `, showing the first ${results.limit}` : ""})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Member</th><th className="p-2">Birthdate</th><th className="p-2">Contact · address</th><th className="p-2">Claimant</th><th className="p-2">Programs</th></tr></thead>
        <tbody>{results.members.map((row) => <tr key={row.id} className="border-t">
          <td className={cell}><Link className="text-primary hover:underline" href={memberLink(row.number)}>{row.name}</Link><span className="block text-xs text-muted-foreground">{row.number}{row.status ? ` · ${row.status}` : ""}</span></td>
          <td className={`${cell} tabular-nums`}>{formatDate(row.birthdate)}</td>
          <td className={cell}>{row.contact || "—"}<span className="block text-xs text-muted-foreground">{row.address}</span></td>
          <td className={cell}>{row.claimant || "—"}<span className="block text-xs text-muted-foreground">{row.claimantContact}</span></td>
          <td className={cell}>{row.programs || "—"}</td>
        </tr>)}</tbody></table></CardContent></Card>}
  </section>;
}
