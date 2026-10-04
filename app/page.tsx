import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle, Building2, CalendarCheck, ClipboardList, Clock3, FilePlus2, HandCoins, PhilippinePeso, PiggyBank, Receipt, ShieldCheck, UserCheck, Users, Wallet, type LucideIcon } from "lucide-react";
import { ExecutiveDashboard } from "@/components/executive-dashboard";
import { FinanceDashboard } from "@/components/finance-dashboard";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { SystemHealthDashboard } from "@/components/system-health-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayInManila } from "@/lib/account-rules";
import type { SessionUser } from "@/lib/auth";
import { getSessionUser } from "@/lib/auth-server";
import { dashboardKind, getDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { getEmployees } from "@/lib/employees";
import { getExecutiveAnalytics, isExecutivePeriod } from "@/lib/executive-analytics";
import { getCommissions, getVendorPayables } from "@/lib/finance-operations";
import { getRemittanceDashboard } from "@/lib/remittance-workflow";
import { getSystemHealth } from "@/lib/system-health";
import { ACTIVE_ROLE_COOKIE } from "@/lib/ui-preferences";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
// Icon and tone follow what a metric measures, so the same idea looks the same on every dashboard.
const metricStyles: Array<[RegExp, LucideIcon, Tone]> = [
  [/difference|discrepanc|late|absent/i, AlertTriangle, "danger"],
  [/attention|follow/i, AlertTriangle, "warning"],
  [/pending|leave/i, Clock3, "warning"],
  [/present/i, CalendarCheck, "success"],
  [/expected/i, Wallet, "warning"],
  [/actual remittance/i, Wallet, "success"],
  [/fidelity/i, PiggyBank, "teal"],
  [/incentive|commission/i, HandCoins, "orange"],
  [/new sales|new accounts|sales today/i, FilePlus2, "brand"],
  [/collection|payments/i, Receipt, "teal"],
  [/gross/i, PhilippinePeso, "brand"],
  [/users/i, ShieldCheck, "info"],
  [/employees|mas|collectors/i, UserCheck, "teal"],
  [/members|portfolio|programs|accounts/i, Users, "brand"],
  [/branches/i, Building2, "orange"],
  [/transactions|encoded/i, ClipboardList, "info"],
];
const metricStyle = (item: Metric) => {
  const [, icon, tone] = metricStyles.find(([pattern]) => pattern.test(item.label)) ?? [/./, ClipboardList, "brand" as Tone];
  // Zero of something bad (a difference, lateness) is good news, not an alert.
  const settled = (tone === "danger" || tone === "warning") && Number(String(item.value).replace(/[^\d.-]/g, "")) === 0;
  return { icon, tone: settled ? "success" as Tone : tone };
};
type Metric = { label: string; value: string | number; detail: string; href?: string };

async function employeeName(user: SessionUser) {
  return (await getEmployees()).find((employee) => employee.id === user.employeeId)?.name || user.name;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // The dashboard follows the workspace chosen in the sidebar; dashboardKind only honours roles the user holds.
  const saved = (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value ?? "";
  let preferred = "";
  try { preferred = decodeURIComponent(saved); } catch { /* ignore a malformed cookie */ }
  const kind = dashboardKind(user, preferred);
  const { period } = await searchParams;
  let loaded: Awaited<ReturnType<typeof load>>;
  try { loaded = await load(user, kind, period); }
  catch (error) { return DashboardError(error instanceof Error ? error.message : "Unable to load dashboard."); }
  switch (loaded.view) {
    case "executive": return <ExecutiveDashboard data={loaded.analytics} employeeName={loaded.name} />;
    case "it": return <SystemHealthDashboard data={loaded.health} employeeName={loaded.name} />;
    case "finance": return <FinanceDashboard employeeName={loaded.name} today={todayInManila()} analytics={loaded.analytics} remittance={loaded.remittance} payables={loaded.payables} commissions={loaded.commissions} />;
    default: return <Operational data={loaded.data} />;
  }
}

// Loads only the data the chosen dashboard shows.
async function load(user: SessionUser, kind: ReturnType<typeof dashboardKind>, period: string | undefined) {
  if (kind === "executive") {
    const [analytics, name] = await Promise.all([getExecutiveAnalytics(isExecutivePeriod(period) ? period : "mtd"), employeeName(user)]);
    return { view: "executive" as const, analytics, name };
  }
  if (kind === "it") {
    const [health, name] = await Promise.all([getSystemHealth(), employeeName(user)]);
    return { view: "it" as const, health, name };
  }
  if (kind === "finance") {
    const [analytics, remittance, payables, commissions, name] = await Promise.all([getExecutiveAnalytics("mtd"), getRemittanceDashboard(), getVendorPayables(), getCommissions(), employeeName(user)]);
    return { view: "finance" as const, analytics, remittance, payables, commissions, name };
  }
  return { view: "operational" as const, data: await getDashboardData(user, kind) };
}

function Operational({ data }: { data: DashboardData }) {
  const view = config(data);
  return <section className="space-y-6"><div><p className="text-sm font-medium text-primary">{view.eyebrow}</p><h1 className="text-2xl font-bold">{view.title}</h1><p className="text-sm text-muted-foreground">Welcome, {data.employeeName}. {view.description}</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{view.metrics.map((item: Metric) => <MetricTile key={item.label} {...item} {...metricStyle(item)}/>)}</div>
    {view.actions && <div className="flex flex-wrap gap-3">{view.actions.map(([label, href]) => <Action key={href} href={href}>{label}</Action>)}</div>}
    <div className="grid gap-6 xl:grid-cols-2">{view.sections}</div>
  </section>;
}

function DashboardError(message: string) { return <section><h1 className="text-2xl font-bold">Dashboard</h1><p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{message}</p></section>; }

type View = { eyebrow: string; title: string; description: string; metrics: Metric[]; actions?: string[][]; sections: React.ReactNode };

function config(data: DashboardData): View {
  const t = data.todayActivity, m = data.monthReport?.summary, r = data.remittance?.summary;
  const monthCollections = data.monthReport?.collections.reduce((sum, row) => sum + row.gross, 0) ?? 0;
  if (data.kind === "hr" && data.people) {
    const p = data.people;
    return { eyebrow: "HR workspace", title: "People Today", description: "Who is in, who is late, and what needs your approval.",
      metrics: [{ label: "Present Today", value: p.present, detail: `of ${data.counts.activeEmployees} active employees`, href: "/attendance-tracking" }, { label: "Late Today", value: p.late, detail: "Clocked in after schedule", href: "/attendance-reviews" }, { label: "On Leave / Absent", value: `${p.onLeave} / ${p.absent}`, detail: `${p.notClockedIn} not yet clocked in`, href: "/attendance-tracking" }, { label: "Pending Leave Requests", value: p.pendingLeaveCount, detail: "Awaiting your decision", href: "/leave-approvals" }],
      actions: [["Leave Approvals", "/leave-approvals"], ["Attendance Review", "/attendance-reviews"], ["Register Employee", "/employees"]],
      sections: <>
        <Panel title="Late Today" description="Employees who clocked in after their schedule today, most minutes late first."><Table headers={["Employee", "Branch", "Time in", "Minutes late"]} rows={p.lateList.map((row) => [row.name, row.branch, row.timeIn, String(row.lateMinutes)])} empty="Nobody is late today."/></Panel>
        <Panel title="Leave Requests Awaiting Decision" description="Leave requests filed by employees that still need to be approved or rejected."><Table headers={["Employee", "Type", "From", "To", "Filed"]} rows={p.pendingLeaves.map((row) => [row.name, row.leaveType, row.startDate, row.endDate, row.createdAt.slice(0, 10)])} empty="No pending leave requests."/></Panel>
        <BranchStaff data={data}/>
        <Panel title="Workforce" description="Headcount across all branches: everyone registered, those active, and active MAS and Collectors."><Rows rows={[["Registered employees", String(data.counts.employees)], ["Active employees", String(data.counts.activeEmployees)], ["Active MAS", String(data.counts.mas)], ["Active collectors", String(data.counts.collectors)]]}/></Panel>
      </> };
  }
  if (data.kind === "entry") return { eyebrow: "Encoding workspace", title: "Today's Encoding", description: "Keep daily sales and collection entries complete and accurate.",
    metrics: [{ label: "Today's New Sales", value: t.salesAccounts, detail: `${money(t.salesGross)} · by ${t.basis.toLowerCase()}`, href: "/todays-entries" }, { label: "Today's Collections", value: t.collectionAccounts, detail: `${money(t.collectionGross)} · by ${t.basis.toLowerCase()}`, href: "/todays-entries" }, { label: "Transactions Encoded", value: data.encodedToday, detail: "Your entries today" }, { label: "Needs Attention", value: r?.historicalReviewCount ?? 0, detail: "Historical review entries", href: "/remittances" }],
    actions: [["+ New Sale", "/new-sales"], ["+ Encode Collection", "/collections"], ["Remittances", "/remittances"], ["Daily Report", "/reports?tab=daily"]],
    sections: <><Recent data={data} title="My Recent Entries" description="The latest New Sales and Collections you encoded, newest first."/><Panel title="Remittance Status" description="Cash the MAS and Collectors still hold, and remittance slips waiting for approval."><Rows rows={[["Cash still with staff", money(r?.outstandingAmount ?? 0)], ["Collections not yet remitted", String(r?.outstandingCount ?? 0)], ["Remittances awaiting approval", `${r?.pendingCount ?? 0} · ${money(r?.pendingAmount ?? 0)}`], ["Approved today", `${r?.approvedTodayCount ?? 0} · ${money(r?.approvedTodayAmount ?? 0)}`]]}/></Panel></> };
  if (data.kind === "mas") return { eyebrow: "My portfolio", title: "MAS Dashboard", description: "Your members, their payment status, and your collections this month.",
    metrics: [{ label: "My Active Accounts", value: data.counts.portfolio, detail: "Assigned enrollments", href: "/members" }, { label: "Collections This Month", value: money(monthCollections), detail: "My portfolio", href: "/mam" }, { label: "Net Commission", value: money((m?.incentives ?? 0) - (m?.fidelity ?? 0)), detail: "After Fidelity savings" }, { label: "Accounts to Follow Up", value: data.portfolioHealth.filter((item) => ["60D", "90D", "120D", "150D"].includes(item.status)).reduce((sum, item) => sum + item.count, 0), detail: "60+ days behind", href: "/mam" }],
    sections: <>
      <Panel title="Follow Up First" description="Your members who are 60 or more days behind on payments, most overdue first. Visit them first."><Table headers={["Member", "Program", "Status", "DOI"]} rows={data.followUp.map((row) => [row.member, row.program, <StatusBadge key="s" status={row.status} tone={row.status === "60D" ? "warning" : "danger"}/>, row.doi])} empty="All your accounts are current."/></Panel>
      <Panel title="Portfolio by Status" description="How many of your active accounts are in each payment status."><div className="flex flex-wrap gap-2">{data.portfolioHealth.map((item) => <StatusBadge key={item.status} status={`${item.status} · ${item.count}`} tone={["NS", "U", "ADV"].includes(item.status) ? "success" : item.status === "FORFEITED" ? "neutral" : item.status === "60D" ? "warning" : "danger"}/>)}{!data.portfolioHealth.length && <p className="text-sm text-muted-foreground">No active accounts yet.</p>}</div><p className="mt-3 text-xs text-muted-foreground">NS new · U updated · ADV advance · 60D–150D days behind.</p></Panel>
      <Portfolio data={data}/><Recent data={data} title="My Recent Activity" description="The latest New Sales and Collections for your members, newest first."/>
    </> };
  if (data.kind === "collector") return { eyebrow: "My collections", title: "Collector Dashboard", description: "Payments you collected and your commission this month.",
    metrics: [{ label: "Collections This Month", value: money(monthCollections), detail: `${m?.accounts ?? 0} payments`, href: "/mam" }, { label: "Today's Collections", value: t.collectionAccounts, detail: `${money(t.collectionGross)} · by ${t.basis.toLowerCase()}` }, { label: "Commission This Month", value: money(m?.collectorCommission ?? 0), detail: "Collector incentives" }, { label: "Expected Remittance", value: money(m?.expectedRemittance ?? 0), detail: "Company share of your collections" }],
    actions: [["Members", "/members"], ["MAM", "/mam"], ["My Attendance", "/attendance"]],
    sections: <><Recent data={data} title="My Recent Collections" description="The latest payments you collected, newest first."/><Panel title="This Month" description="What you collected since the 1st of this month, your commission, and what you must remit."><Rows rows={[["Gross collected", money(monthCollections)], ["Commission", money(m?.collectorCommission ?? 0)], ["To remit", money(m?.expectedRemittance ?? 0)]]}/></Panel></> };
  return { eyebrow: "Administration workspace", title: "System Overview", description: "Master data, current activity, and items requiring attention.",
    metrics: [{ label: "Members", value: data.counts.members, detail: "Master records", href: "/members" }, { label: "Active Employees", value: data.counts.activeEmployees, detail: `${data.counts.employees} total employees`, href: "/employees" }, { label: "Active Users", value: data.counts.users, detail: "Enabled accounts", href: "/user-accounts" }, { label: "Branches / Programs", value: `${data.counts.branches} / ${data.counts.programs}`, detail: "Active master data" }, { label: "Sales Today", value: t.salesAccounts, detail: `${money(t.salesGross)} · by ${t.basis.toLowerCase()}`, href: "/todays-entries" }, { label: "Collections Today", value: t.collectionAccounts, detail: `${money(t.collectionGross)} · by ${t.basis.toLowerCase()}`, href: "/todays-entries" }, { label: "Pending Remittances", value: r?.pendingCount ?? 0, detail: money(r?.pendingAmount ?? 0), href: "/remittances" }, { label: "Remittance Difference", value: money(r?.discrepancyAmount ?? 0), detail: "Requires reconciliation", href: "/remittances" }],
    sections: <><Recent data={data} title="Recent Entries" description="The latest New Sales and Collections encoded by anyone, newest first."/><Panel title="Items Requiring Attention" description="Remittance problems waiting for someone: slips to approve, cash shortages, and cash not yet turned in."><Attention label="Pending Remittances" value={r?.pendingCount ?? 0} href="/remittances"/><Attention label="Remittance Discrepancies" value={r?.discrepancyAmount ?? 0} href="/remittances" moneyValue/><Attention label="Cash Still With Staff" value={r?.outstandingAmount ?? 0} href="/remittances" moneyValue/><div className="mt-4 grid gap-2 sm:grid-cols-2"><Action href="/history">Audit Log</Action><Action href="/roles">Manage Roles</Action></div></Panel></> };
}

function Recent({ data, title, description }: { data: DashboardData; title: string; description: string }) { return <Panel title={title} description={description}><Table headers={["Date / Time", "Member", "Program", "Type", "Amount", "Status"]} rows={data.recent.map((row) => [row.stamp.replace("T", " ").slice(0, 16), row.name, row.program, row.type, money(row.amount), <StatusBadge key="status" status={row.status}/>])}/></Panel>; }
function BranchStaff({ data }: { data: DashboardData }) { return <Panel title="Staff by Branch" description="Active employees in each branch, with how many are MAS and Collectors."><Table headers={["Branch", "Employees", "MAS", "Collectors"]} rows={data.branchStats.map((row) => [row.branch, String(row.employees), String(row.mas), String(row.collectors)])}/></Panel>; }
function Portfolio({ data }: { data: DashboardData }) { return <Panel title="My Members" description="The first 8 of your active member accounts. Open Members to see them all."><Table headers={["Member", "Program", "Branch", "Status", "DOI"]} rows={data.portfolio.map((row) => [row.member, row.program, row.branch, row.status, row.doi])}/></Panel>; }
function Rows({ rows }: { rows: string[][] }) { return <dl className="space-y-2 text-sm">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>; }
function Action({ href, children }: { href: string; children: React.ReactNode }) { return <Link href={href} className="rounded-xl border bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary">{children}</Link>; }
function Attention({ label, value, href, moneyValue = false }: { label: string; value: number; href: string; moneyValue?: boolean }) { return <Link href={href} className={`mb-3 flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted ${value ? "tone-warning" : "tone-success"}`}><span className="flex items-center gap-2"><span className="tone-bar size-2 rounded-full" aria-hidden/>{label}</span><strong className="tabular-nums">{moneyValue ? money(value) : value}</strong></Link>; }
// Every section says in one line what it shows, so users know what they are looking at.
function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle>{title}</CardTitle><p className="text-sm text-muted-foreground">{description}</p></CardHeader><CardContent>{children}</CardContent></Card>; }
function Table({ headers, rows, empty = "No current records." }: { headers: string[]; rows: React.ReactNode[][]; empty?: string }) { return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="pb-3 pr-4 text-muted-foreground">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row[0])}-${index}`} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className="py-3 pr-4">{cell || "—"}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="py-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }
