import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, ShieldCheck, UserCog, XCircle, type LucideIcon } from "lucide-react";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemHealth } from "@/lib/system-health";

const count = (value: number) => value.toLocaleString("en-PH");
const stamp = (value: string) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const severityTone: Record<string, Tone> = { critical: "danger", warning: "warning", info: "info" };

export function SystemHealthDashboard({ data, employeeName }: { data: SystemHealth; employeeName: string }) {
  const critical = data.issues.filter((issue) => issue.severity === "critical").length, warnings = data.issues.filter((issue) => issue.severity === "warning").length;
  const overall: { label: string; tone: Tone; icon: LucideIcon } = critical ? { label: `${critical} critical issue${critical > 1 ? "s" : ""}`, tone: "danger", icon: XCircle } : warnings ? { label: `${warnings} warning${warnings > 1 ? "s" : ""}`, tone: "warning", icon: AlertTriangle } : { label: "All checks passed", tone: "success", icon: CheckCircle2 };
  const r = data.runtime;
  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">IT workspace</p><h1 className="text-2xl font-bold">System Health</h1><p className="text-sm text-muted-foreground">Welcome, {employeeName}. Access integrity, data capacity, and the Google Sheets connection for {data.spreadsheet || "the workbook"}.</p></div>
      <span className={`tone-chip tone-${overall.tone} inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold`}><overall.icon className="size-4" />{overall.label}</span>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Google Sheets response" value={`${count(data.latencyMs)} ms`} note={data.latencyMs < 1500 ? "Healthy" : data.latencyMs < 4000 ? "Slow; many users or large sheets" : "Very slow; check quota and sheet size"} icon={Activity} tone={data.latencyMs < 1500 ? "success" : data.latencyMs < 4000 ? "warning" : "danger"} />
      <Tile label="Spreadsheet capacity" value={`${data.capacity.percent}%`} note={`${count(data.capacity.cells)} of ${count(data.capacity.limit)} cells · ${data.capacity.tabCount} tabs`} icon={Database} tone={data.capacity.percent < 60 ? "success" : data.capacity.percent < 85 ? "warning" : "danger"} />
      <Tile label="Active accounts" value={`${count(data.accounts.active)} / ${count(data.accounts.total)}`} note={`${count(data.accounts.activeEmployees)} active employees`} icon={UserCog} tone="info" href="/user-accounts" />
      <Tile label="Access issues" value={count(data.issues.reduce((sum, issue) => sum + issue.items.length, 0))} note={`${critical} critical · ${warnings} warning checks`} icon={ShieldCheck} tone={overall.tone} />
    </div>

    <Panel title="Access & Data Integrity" subtitle="Accounts, roles and employees checked against each other">
      {data.issues.length ? <ul className="space-y-3">{data.issues.map((issue) => <li key={issue.title} className={`tone-${severityTone[issue.severity]} rounded-xl border p-3`}>
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2"><StatusBadge status={issue.severity === "critical" ? "Critical" : issue.severity === "warning" ? "Review" : "Info"} tone={severityTone[issue.severity]} /><strong className="text-sm">{issue.title}</strong><span className="text-sm text-muted-foreground">({issue.items.length})</span></span>
            <Link href={issue.href} className="text-sm font-medium text-primary hover:underline">Fix</Link>
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">{issue.detail}</p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">{issue.items.map((item) => <li key={item} className="rounded-md bg-muted/60 px-2 py-1">{item}</li>)}</ul>
        </details>
      </li>)}</ul> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" />Every account has a role, matches an active employee, and agrees with the Employees register.</p>}
    </Panel>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Roles & Permissions" subtitle="Active users per role and what each role may do">
        <Table headers={["Role", "Users", "Manage users", "Attendance", "Reports", "Page access"]} rows={data.roles.map((role) => [<span key="n" className={role.active ? "font-medium" : "text-muted-foreground line-through"}>{role.name}</span>, count(role.users), <Flag key="u" on={role.manageUsers} />, <Flag key="a" on={role.manageAttendance} />, <Flag key="r" on={role.viewAttendanceReports} />, role.customPages ? "Custom" : "Default"])} />
        <p className="mt-3 text-xs text-muted-foreground">Changes to roles apply the next time affected users sign in. <Link href="/roles" className="text-primary hover:underline">Manage roles</Link></p>
      </Panel>
      <div className="space-y-6">
        <Panel title="Deployment Configuration" subtitle="Server settings the app needs to reach Google Sheets; each must show a check.">
          <ul className="space-y-2 text-sm">{data.config.map((item) => <li key={item.label} className="flex items-start justify-between gap-4"><span className="flex items-center gap-2">{item.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}{item.label}</span><span className="text-right text-muted-foreground">{item.detail}</span></li>)}</ul>
        </Panel>
        <Panel title="Google API Usage" subtitle={`This server instance, last ${count(r.uptimeMinutes)} minutes`}>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[["Reads", r.reads], ["Writes", r.writes], ["Retries", r.retries], ["Failures", r.failures]].map(([label, value]) => <div key={label} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-bold tabular-nums">{count(Number(value))}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{r.lastFailure ? `Last failure: ${r.lastFailure}` : "No failed requests."} Reads are cached for 60 seconds and shared by all users; a save clears only the sheets it changed.</p>
        </Panel>
      </div>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Largest Tabs" subtitle="Allocated grid cells; delete unused rows and columns to free space">
        <ul className="space-y-2">{data.capacity.tabs.map((tab) => <li key={tab.title} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm"><span className="truncate font-medium">{tab.title}</span><span className="tabular-nums text-muted-foreground">{count(tab.rows)} × {count(tab.columns)}</span><span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(1, (tab.cells / (data.capacity.tabs[0]?.cells || 1)) * 100)}%` }} /></span></li>)}</ul>
      </Panel>
      <Panel title="Recent Changes" subtitle="Latest edits and deletions from the Audit Log">
        <Table headers={["When", "Action", "Sheet", "Record", "By"]} rows={data.audit.map((entry) => [stamp(entry.at), <StatusBadge key="a" status={entry.action} tone={entry.action === "Deleted" ? "danger" : "info"} />, entry.sheet, entry.recordId, entry.by])} empty="No edits or deletions recorded yet." />
        <p className="mt-3 text-xs text-muted-foreground"><Link href="/history" className="text-primary hover:underline">Open the full Audit Log</Link></p>
      </Panel>
    </div>

    <Panel title="Quick Actions" subtitle="Shortcuts to the pages IT uses most."><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["User Accounts", "/user-accounts"], ["Roles", "/roles"], ["Employees", "/employees"], ["Branches & Programs", "/branches"], ["Audit Log", "/history"]].map(([label, href]) => <Link key={href} href={href} className="rounded-xl border bg-card px-4 py-3 text-sm font-semibold shadow-sm transition-colors hover:border-primary hover:text-primary">{label}</Link>)}</div></Panel>
    <p className="text-xs text-muted-foreground">Checked {stamp(data.checkedAt)}. <Gauge className="inline size-3" /> Reload the page to run the checks again.</p>
  </section>;
}

function Tile({ label, value, note, icon: Icon, tone, href }: { label: string; value: string; note: string; icon: LucideIcon; tone: Tone; href?: string }) {
  const body = <div data-slot="card" className={`tone-${tone} relative h-full overflow-hidden rounded-[1.25rem] p-4`}><span className="tone-bar absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden /><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{label}</p><span className="tone-soft flex size-9 shrink-0 items-center justify-center rounded-xl"><Icon className="size-4.5" /></span></div><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
  return href ? <Link href={href} className="block rounded-[1.25rem]">{body}</Link> : body;
}
function Flag({ on }: { on: boolean }) { return on ? <CheckCircle2 className="inline size-4 text-emerald-600" aria-label="Yes" /> : <span className="text-muted-foreground" aria-label="No">—</span>; }
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle>{title}</CardTitle>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</CardHeader><CardContent>{children}</CardContent></Card>; }
function Table({ headers, rows, empty = "No records." }: { headers: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="pb-2 pr-3 font-medium text-muted-foreground">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className="py-2 pr-3">{cell || "—"}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="py-6 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>;
}
