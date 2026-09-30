import Link from "next/link";
import { Award, Building2, FilePlus2, Lightbulb, PhilippinePeso, Receipt, TrendingDown, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react";
import { Change, Columns, RankBars, RevenueTrend, ShareBar } from "@/components/executive-charts";
import type { Tone } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { executivePeriods, type ExecutiveAnalytics, type Ranked } from "@/lib/executive-analytics";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
const growth = (row: Ranked) => row.previous ? ((row.amount - row.previous) / row.previous) * 100 : null;
const longDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const healthColors = ["var(--brand-moss)", "var(--brand-gold)", "var(--brand-orange)", "var(--brand-red)", "var(--muted-foreground)"];

export function ExecutiveDashboard({ data, employeeName }: { data: ExecutiveAnalytics; employeeName: string }) {
  const k = data.kpis, f = data.finance;
  const topPrograms = data.programs.slice(0, 8);
  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">Executive overview</p><h1 className="text-2xl font-bold">Company Performance</h1><p className="text-sm text-muted-foreground">Welcome, {employeeName}. {data.periodLabel}: {longDate(data.from)} – {longDate(data.to)}, compared {data.compareLabel.replace(/^vs /, "with ")}.</p></div>
      <nav aria-label="Reporting period" className="flex flex-wrap gap-1 rounded-xl border bg-card p-1">
        {Object.entries(executivePeriods).map(([key, period]) => <Link key={key} href={key === "mtd" ? "/" : `/?period=${key}`} aria-current={data.period === key ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${data.period === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{period.label}</Link>)}
      </nav>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Total Revenue" value={money(k.revenue.value)} change={k.revenue.change} note="New Sales + Collections" icon={PhilippinePeso} tone="brand" />
      <Kpi label="New Sales" value={money(k.salesGross.value)} change={k.salesGross.change} note={`${k.newAccounts.value.toLocaleString("en-PH")} new accounts`} icon={FilePlus2} tone="brand" />
      <Kpi label="Collections" value={money(k.collectionGross.value)} change={k.collectionGross.change} note={`${k.collectionCount.toLocaleString("en-PH")} posted payments`} icon={Receipt} tone="teal" />
      <Kpi label="Net Retained" value={money(f.retained)} note="Revenue less commissions and expenses" icon={Wallet} tone={f.retained < 0 ? "danger" : "success"} />
      <Kpi label="New Accounts" value={k.newAccounts.value.toLocaleString("en-PH")} change={k.newAccounts.change} note="Enrollments sold" icon={Users} tone="info" />
      <Kpi label="Average Sale" value={money(k.averageSale.value)} change={k.averageSale.change} note="Per new account" icon={TrendingUp} tone="orange" />
      <Kpi label="Active Accounts" value={k.activeAccounts.toLocaleString("en-PH")} note={`${k.members.toLocaleString("en-PH")} members on record`} icon={Users} tone="teal" />
      <Kpi label="Accounts Current" value={`${k.currentRate.toFixed(1)}%`} note="Active accounts not yet 60 days late" icon={Award} tone={k.currentRate >= 80 ? "success" : k.currentRate >= 60 ? "warning" : "danger"} />
    </div>

    <Highlights data={data} />

    <div className="grid gap-6 xl:grid-cols-3">
      <Panel title="Revenue Trend" subtitle="Last 12 months, by month" className="xl:col-span-2"><RevenueTrend points={data.trend} /></Panel>
      <Panel title="Where the Money Goes" subtitle={data.periodLabel}>
        <Rows rows={[["Revenue", money(f.revenue)], ["Commissions paid out", `– ${money(f.commissions)}`], ["Expenses", `– ${money(f.expenses)}`], ["Net retained", money(f.retained), true]]} />
        <div className="my-4 border-t" />
        <Rows rows={[["Expected remittance", money(f.expectedRemittance)], ["Actual remittance", money(f.actualRemittance)], ["Remittance gap", money(f.gap), true], ["Awaiting approval", `${f.pendingCount} · ${money(f.pendingAmount)}`]]} />
      </Panel>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Best-Selling Programs" subtitle="New Sales value, with change vs previous period"><RankBars rows={topPrograms.map((row) => ({ label: row.label, value: row.amount, secondary: `${row.accounts} sold · ${row.share.toFixed(0)}%`, change: growth(row) }))} /></Panel>
      <Panel title="Programs by Collections" subtitle="Payments received on existing accounts"><RankBars rows={data.programCollections.slice(0, 8).map((row) => ({ label: row.label, value: row.amount, secondary: `${row.accounts} payments · ${row.share.toFixed(0)}%`, change: growth(row) }))} /></Panel>
    </div>

    <Panel title="Branch Performance" subtitle="Ranked by total revenue">
      <Table headers={["Branch", "New accounts", "New Sales", "Collections", "Total revenue", "Share", "Change"]} rows={data.branches.map((row) => [<span key="b" className="font-medium">{row.label}</span>, row.newAccounts.toLocaleString("en-PH"), money(row.sales), money(row.collections), <strong key="t" className="tabular-nums">{money(row.amount)}</strong>, <ShareCell key="s" value={row.share} />, <Change key="c" value={growth(row)} />])} />
    </Panel>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Top Sales Agents (MAS)" subtitle="By New Sales value"><RankBars rows={data.salesPeople.map((row) => ({ label: row.label, value: row.amount, secondary: `${row.accounts} accounts`, change: growth(row) }))} /></Panel>
      <Panel title="Top Collectors" subtitle="By payments collected"><RankBars rows={data.collectors.map((row) => ({ label: row.label, value: row.amount, secondary: `${row.accounts} payments`, change: growth(row) }))} /></Panel>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Account Health" subtitle={`${data.trackedAccounts.toLocaleString("en-PH")} active accounts by payment status`}>
        <ShareBar label="Active accounts by payment status" segments={data.accountHealth.map((group, index) => ({ label: group.label, value: group.count, color: healthColors[index] }))} />
        <div className="mt-5"><Table compact headers={["Program", "Active", "60+ days late", "Late rate"]} rows={data.healthByProgram.slice(0, 6).map((row) => [row.label, row.active.toLocaleString("en-PH"), row.late.toLocaleString("en-PH"), <span key="r" className={`font-semibold tabular-nums ${row.lateRate >= 25 ? "text-red-700 dark:text-red-400" : row.lateRate >= 10 ? "text-amber-700" : ""}`}>{row.lateRate.toFixed(1)}%</span>])} /></div>
      </Panel>
      <Panel title="Best Selling Days" subtitle="New accounts by day of the week">
        <Columns label="New accounts by day of the week" items={data.weekdays.map((row) => ({ label: row.label, value: row.accounts, detail: `${row.accounts} accounts · ${money(row.amount)}` }))} />
      </Panel>
    </div>

    <div className="grid gap-6 xl:grid-cols-3">
      <Panel title="Payment Modes" subtitle="How new members choose to pay"><RankBars format="count" rows={data.paymentModes.slice(0, 6).map((row) => ({ label: row.label, value: row.accounts, secondary: money(row.amount) }))} /></Panel>
      <Panel title="Buyer Age" subtitle="New members by age group"><Columns label="New members by age group" items={data.ageBands.map((row) => ({ label: row.label, value: row.accounts, detail: `${row.accounts} new members` }))} /></Panel>
      <Panel title="Buyer Gender" subtitle="New members this period"><ShareBar label="New members by gender" segments={data.genders.slice(0, 3).map((row, index) => ({ label: row.label, value: row.accounts, color: ["var(--viz-1)", "var(--viz-2)", "var(--muted-foreground)"][index] }))} /></Panel>
    </div>
  </section>;
}

/** Plain-language findings so the numbers above lead somewhere. */
function Highlights({ data }: { data: ExecutiveAnalytics }) {
  const compared = data.programs.filter((row) => row.previous > 0 && row.amount > 0);
  const rising = [...compared].sort((a, b) => (growth(b) ?? 0) - (growth(a) ?? 0))[0];
  const falling = data.programs.filter((row) => row.previous > 0).sort((a, b) => (growth(a) ?? 0) - (growth(b) ?? 0))[0];
  const items: Array<{ icon: LucideIcon; tone: Tone; text: React.ReactNode }> = [];
  const [program, branch, agent] = [data.programs[0], data.branches[0], data.salesPeople[0]];
  if (program) items.push({ icon: Award, tone: "brand", text: <><strong>{program.label}</strong> sells the most: {program.accounts} accounts, {money(program.amount)} ({program.share.toFixed(0)}% of New Sales).</> });
  if (branch) items.push({ icon: Building2, tone: "orange", text: <><strong>{branch.label}</strong> leads the branches with {money(branch.amount)} in revenue ({branch.share.toFixed(0)}% of the company).</> });
  if (agent) items.push({ icon: Users, tone: "teal", text: <><strong>{agent.label}</strong> is the top sales agent with {agent.accounts} new accounts worth {money(agent.amount)}.</> });
  if (rising && (growth(rising) ?? 0) > 0) items.push({ icon: TrendingUp, tone: "success", text: <><strong>{rising.label}</strong> is growing fastest, up {growth(rising)!.toFixed(0)}% {data.compareLabel}.</> });
  if (falling && (growth(falling) ?? 0) < 0) items.push({ icon: TrendingDown, tone: "danger", text: <><strong>{falling.label}</strong> sales fell {Math.abs(growth(falling)!).toFixed(0)}% {data.compareLabel}.</> });
  if (data.kpis.currentRate < 80 && data.trackedAccounts) items.push({ icon: TrendingDown, tone: "warning", text: <>Only <strong>{data.kpis.currentRate.toFixed(0)}%</strong> of active accounts are current; {(data.trackedAccounts - data.accountHealth[0].count).toLocaleString("en-PH")} are 60+ days late or forfeited.</> });
  if (!items.length) return null;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-primary" />Highlights</CardTitle></CardHeader><CardContent><ul className="grid gap-3 md:grid-cols-2">{items.map((item, index) => <li key={index} className={`tone-${item.tone} flex items-start gap-3 rounded-xl border p-3 text-sm`}><span className="tone-soft flex size-8 shrink-0 items-center justify-center rounded-lg"><item.icon className="size-4" /></span><span className="pt-1.5">{item.text}</span></li>)}</ul></CardContent></Card>;
}

function Kpi({ label, value, change, note, icon: Icon, tone }: { label: string; value: string; change?: number | null; note: string; icon: LucideIcon; tone: Tone }) {
  return <div data-slot="card" className={`tone-${tone} relative overflow-hidden rounded-[1.25rem] p-4`}>
    <span className="tone-bar absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden />
    <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{label}</p><span className="tone-soft flex size-9 shrink-0 items-center justify-center rounded-xl"><Icon className="size-4.5" /></span></div>
    <p className="mt-1 break-words text-xl font-bold tracking-tight text-foreground tabular-nums sm:text-2xl">{value}</p>
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{change !== undefined && <Change value={change} />}<span>{note}</span></p>
  </div>;
}

function Panel({ title, subtitle, className = "", children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return <Card className={className}><CardHeader><CardTitle>{title}</CardTitle>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</CardHeader><CardContent>{children}</CardContent></Card>;
}

function Rows({ rows }: { rows: Array<[string, string, boolean?]> }) {
  return <dl className="space-y-2 text-sm">{rows.map(([label, value, strong]) => <div key={label} className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt><dd className={`tabular-nums ${strong ? "font-bold" : "font-medium"}`}>{value}</dd></div>)}</dl>;
}

function ShareCell({ value }: { value: number }) {
  return <span className="viz flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${value}%`, background: "var(--viz-1)" }} /></span><span className="tabular-nums">{value.toFixed(1)}%</span></span>;
}

function Table({ headers, rows, compact = false }: { headers: string[]; rows: React.ReactNode[][]; compact?: boolean }) {
  return <div className="overflow-x-auto"><table className={`w-full text-left text-sm ${compact ? "" : "min-w-[720px]"}`}><thead><tr className="border-b">{headers.map((header, index) => <th key={header} className={`pb-3 pr-4 font-medium text-muted-foreground ${index ? "text-right" : ""}`}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className={`py-2.5 pr-4 ${i ? "text-right tabular-nums [&>span]:justify-end" : ""}`}>{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="py-8 text-center text-muted-foreground">No activity in this period.</td></tr>}</tbody></table></div>;
}
