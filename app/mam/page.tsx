"use client";

import { useEffect, useRef, useState } from "react";
import type { buildMamReport } from "@/lib/mam-report";
import { todayInManila } from "@/lib/account-rules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Download,
  Printer,
  RefreshCw,
  Search,
  Filter,
  Users,
  Wallet,
  TrendingUp,
  AlertTriangle,
  X,
  Calendar,
  Building2,
  FileText,
} from "lucide-react";

type Report = ReturnType<typeof buildMamReport>;
type Row = Report["rows"][number];

const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

const statuses = ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Forfeited"];

const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}-01T00:00:00Z`)
  );

const csvCell = (value: unknown) =>
  `"${String(value ?? "").replace(/^[=+@\-]/, "'$&").replaceAll('"', '""')}"`;

// Status badge styling helper
const getStatusBadgeVariant = (status?: string) => {
  switch (status) {
    case "ADV":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200";
    case "NS":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200";
    case "U":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200";
    case "60D":
    case "90D":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200";
    case "120D":
    case "150D":
    case "Forfeited":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200";
    default:
      return "bg-secondary text-secondary-foreground";
  }
};

export default function MamPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [from, setFrom] = useState(() => todayInManila().slice(0, 7));
  const [to, setTo] = useState(() => todayInManila().slice(0, 7));
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");
  const [program, setProgram] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const pending = useRef<AbortController | null>(null);

  async function load(sync = false) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      if (!from || !to || from > to) throw new Error("Choose a valid From / To month range.");
      if (sync) {
        const response = await fetch("/api/mam", { method: "POST", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to sync statuses.");
      }
      const response = await fetch(`/api/mam?from=${from}&to=${to}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAM.");
      if (!controller.signal.aborted) setReport(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load MAM.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void fetch("/api/mam", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAM.");
        if (!controller.signal.aborted) setReport(result);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load MAM.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => pending.current?.abort();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  const rows =
    report?.rows.filter(
      (r) =>
        (!branch || r.branch === branch) &&
        (!mas || r.mas === mas) &&
        (!program || r.programId === program) &&
        (!status || r.periods.some((p) => p.state?.status === status)) &&
        `${r.memberName} ${r.memberNumber} ${r.applicationNumber}`.toLowerCase().includes(search.toLowerCase())
    ) ?? [];

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.branch}\u0000${row.mas}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const totalCollected = rows.reduce(
    (sum, row) => sum + row.periods.reduce((subtotal, period) => subtotal + period.collected, 0),
    0
  );
  const quota = rows.reduce((sum, row) => sum + (row.periods.at(-1)?.state?.balance ?? 0), 0);
  const lastMonthCollected = rows.reduce((sum, row) => sum + (row.periods.at(-1)?.collected ?? 0), 0);
  const activeCount = rows.filter((row) => {
    const p = row.periods.at(-1);
    return p?.state && p.state.status !== "Forfeited" && !p.state.temporarilySuspended;
  }).length;

  const options = (field: "branch" | "mas") =>
    [...new Set(report?.rows.map((r) => r[field]) ?? [])].sort();

  function exportCsv() {
    const table: unknown[][] = [
      [
        "Branch",
        "MAS",
        "Member",
        "Member Number",
        "Program",
        "Month",
        "Status",
        "Amount Received",
        "Covered Amount",
        "NOP",
        "TMD",
        "Balance",
        "Suspended",
        "Error",
      ],
    ];
    for (const row of rows)
      for (const period of row.periods)
        table.push([
          row.branch,
          row.mas,
          row.memberName,
          row.memberNumber,
          row.programName,
          period.month,
          period.state?.status,
          period.collected,
          period.coveredAmount,
          period.state?.nop,
          period.state?.tmd,
          period.state?.balance,
          period.state?.temporarilySuspended ? "Yes" : "No",
          period.error,
        ]);
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + table.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `MAM-${report?.from}-${report?.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mam-report space-y-6 p-4 md:p-6 max-w-[1600px] mx-auto text-foreground">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Member Account Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track account coverage, payment histories, and overall balances across branches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button disabled={busy} variant="outline" size="sm" onClick={() => void load(true)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Sync Statuses
          </Button>
          <Button disabled={!report} variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button disabled={!report} variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      <Card className="print:hidden border-border/60 shadow-xs">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
            <Filter className="h-4 w-4" /> Filter Monitoring Scope
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">From Month</label>
            <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">To Month</label>
            <Input type="month" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Branch</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">All branches</option>
              {options("branch").map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">MAS</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={mas}
              onChange={(e) => setMas(e.target.value)}
            >
              <option value="">All MAS</option>
              {options("mas").map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Program</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
            >
              <option value="">All programs</option>
              {[...new Map(report?.rows.map((r) => [r.programId, r.programName])).entries()].map(
                ([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Status</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Member, PH#, APP#"
              />
            </div>
          </div>
          <div className="flex items-end gap-2 pt-1">
            <Button className="w-full" disabled={busy} onClick={() => void load()}>
              {busy ? "Loading..." : "Apply Range"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setBranch("");
                setMas("");
                setProgram("");
                setStatus("");
                setSearch("");
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg bg-destructive/15 border border-destructive/30 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {report && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-md">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            Showing <strong>{monthLabel(report.from)}</strong> – <strong>{monthLabel(report.to)}</strong> · As of {report.today}. Scroll horizontally to view monthly details.
          </span>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Active Accounts</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Range end snapshot</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Collections Received</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(totalCollected)}</div>
            <p className="text-xs text-muted-foreground mt-1">Total within range</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Quota Remaining</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(quota)}</div>
            <p className="text-xs text-muted-foreground mt-1">At range end</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Final Month Collection Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {quota ? `${((lastMonthCollected / quota) * 100).toFixed(1)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Collection / Quota</p>
          </CardContent>
        </Card>
      </div>

      {/* Status Counters */}
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => {
          const count = rows.filter((r) => r.periods.at(-1)?.state?.status === s).length;
          return (
            <Badge key={s} variant="outline" className={`px-2.5 py-1 text-xs font-medium ${getStatusBadgeVariant(s)}`}>
              {s}: {count}
            </Badge>
          );
        })}
      </div>

      {/* Main Monitoring Section */}
      {[...groups].map(([key, group]) => (
        <Card key={key} className="overflow-hidden border-border/80 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span>MAS: {group[0].mas}</span>
              <span className="font-normal text-muted-foreground">· {group[0].branch}</span>
            </div>
            <Badge variant="secondary" className="font-normal">
              {group.length} {group.length === 1 ? "account" : "accounts"}
            </Badge>
          </div>

          <div className="mam-scroll overflow-x-auto" tabIndex={0} role="region" aria-label={`Monthly monitoring for ${group[0].mas}`}>
            <table className="w-max min-w-full border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/20 text-left">
                  <th className="sticky left-0 z-20 w-72 min-w-72 bg-background p-4 shadow-[1px_0_0_0_rgba(0,0,0,0.1)] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">
                    Member / Program Details
                  </th>
                  {report?.months.map((month) => (
                    <th key={month} className="min-w-[20rem] border-l p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{monthLabel(month)}</span>
                        {month > report.today.slice(0, 7) && (
                          <Badge variant="outline" className="text-[10px] font-normal py-0">
                            Projected
                          </Badge>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {group.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-muted/10 transition-colors">
                    <td className="sticky left-0 z-10 max-w-72 bg-background p-4 shadow-[1px_0_0_0_rgba(0,0,0,0.1)] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">
                      <button
                        className="text-left font-semibold text-primary underline-offset-4 hover:underline text-sm"
                        onClick={() => setSelected(row)}
                      >
                        {row.memberName}
                      </button>
                      <p className="text-muted-foreground font-mono text-[11px]">{row.memberNumber}</p>
                      <p className="font-medium mt-0.5 text-foreground">{row.programName}</p>
                      <div className="mt-3 space-y-1 text-muted-foreground text-[11px] bg-muted/30 p-2 rounded border">
                        <div>
                          APP: <span className="font-mono text-foreground">{row.applicationNumber || "—"}</span>
                        </div>
                        <div>DOI: {row.doi}</div>
                        <div>Monthly: {money(row.basePay)}</div>
                        <div>Reg Fee: {money(row.registrationFee)}</div>
                      </div>
                    </td>

                    {row.periods.map((period) => (
                      <td key={period.month} className="min-w-[20rem] max-w-96 border-l p-4">
                        {period.error ? (
                          <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-destructive">
                            <span className="font-semibold">Needs review:</span> {period.error}
                          </div>
                        ) : !period.state ? (
                          <span className="italic text-muted-foreground">Not enrolled yet</span>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 border-b pb-2">
                              <Badge className={`border font-mono text-[10px] ${getStatusBadgeVariant(period.state.status)}`}>
                                {period.state.status}
                              </Badge>
                              <span className="font-bold text-sm">{money(period.collected)}</span>
                            </div>

                            {period.state.temporarilySuspended && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                                Temporarily suspended · Waiver required
                              </p>
                            )}

                            <div className="space-y-1.5">
                              {period.receipts.length ? (
                                period.receipts.map((p) => (
                                  <div key={p.id} className="rounded border bg-muted/20 p-2 text-[11px]">
                                    <div className="flex justify-between font-semibold">
                                      <span>OR #{p.orNumber}</span>
                                      <span>{money(p.amount)}</span>
                                    </div>
                                    <div className="text-muted-foreground mt-0.5">
                                      OR Date: {p.orDate}
                                    </div>
                                    <div className="text-muted-foreground">
                                      Covers: {p.monthFrom} – {p.monthTo} (NOP {p.nopFrom}-{p.nopTo})
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <p className="italic text-muted-foreground text-[11px]">No payment recorded.</p>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 border-t pt-2 text-[11px]">
                              <span className="text-muted-foreground">Covered:</span>
                              <span className="text-right font-medium">{money(period.coveredAmount)}</span>
                              <span className="text-muted-foreground">NOP / TMD:</span>
                              <span className="text-right font-medium">
                                {period.state.nop} / {money(period.state.tmd)}
                              </span>
                              <span className="font-semibold">Balance:</span>
                              <span className="text-right font-bold">
                                {period.state.balance === null ? "—" : money(period.state.balance)}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 font-semibold border-t">
                  <td className="sticky left-0 bg-background p-4 shadow-[1px_0_0_0_rgba(0,0,0,0.1)]">
                    MAS Totals
                  </td>
                  {report?.months.map((month, i) => (
                    <td key={month} className="border-l p-4 text-[11px] space-y-0.5">
                      <div>Collected: {money(group.reduce((sum, row) => sum + row.periods[i].collected, 0))}</div>
                      <div className="text-muted-foreground">
                        Quota: {money(group.reduce((sum, row) => sum + (row.periods[i].state?.balance ?? 0), 0))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ))}

      {!busy && !rows.length && (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          No account entries match your applied filters.
        </div>
      )}

      {/* Account Details Slide-over Drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity print:hidden"
          onClick={() => setSelected(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Account details"
            className="ml-auto flex h-full w-full max-w-md flex-col bg-background shadow-2xl animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-bold">Account Details</h2>
              <Button size="icon" variant="ghost" autoFocus onClick={() => setSelected(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h3 className="text-xl font-bold">{selected.memberName}</h3>
                <p className="text-sm font-mono text-muted-foreground">{selected.memberNumber}</p>
                <Badge variant="secondary" className="mt-2">
                  {selected.programName}
                </Badge>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MAS:</span>
                  <span className="font-medium">{selected.mas}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Branch:</span>
                  <span className="font-medium">{selected.branch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date of Issuance:</span>
                  <span className="font-medium">{selected.doi}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly Base Pay:</span>
                  <span className="font-semibold">{money(selected.basePay)}</span>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-3">Complete Payment History</h4>
                {selected.history.length ? (
                  <div className="space-y-3">
                    {selected.history.map((p) => (
                      <div key={p.id} className="rounded-lg border p-3 text-xs space-y-1 bg-card">
                        <div className="flex justify-between font-bold text-sm">
                          <span>{money(p.amount)}</span>
                          <span className="text-muted-foreground font-normal text-xs">{p.orDate}</span>
                        </div>
                        <p className="font-mono text-muted-foreground">OR #{p.orNumber}</p>
                        <div className="border-t pt-1.5 mt-1 text-muted-foreground">
                          Covers: {p.monthFrom} – {p.monthTo} (NOP {p.nopFrom} – {p.nopTo})
                        </div>
                        <div className="text-muted-foreground">
                          Remitted: {p.dateRemitted || "Unremitted"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No payment transactions found.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
