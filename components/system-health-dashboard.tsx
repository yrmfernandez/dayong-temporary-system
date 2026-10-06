import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, Layers, UserCog, XCircle, type LucideIcon } from "lucide-react";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemHealth } from "@/lib/system-health";

const count = (value: number) => value.toLocaleString("en-PH");
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("en-PH", { maximumFractionDigits: 1 })} MB`;
const stamp = (value: string) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const severityTone: Record<string, Tone> = { critical: "danger", warning: "warning", info: "info" };

export function SystemHealthDashboard({ data, employeeName }: { data: SystemHealth; employeeName: string }) {
  const critical = data.issues.filter((issue) => issue.severity === "critical").length, warnings = data.issues.filter((issue) => issue.severity === "warning").length;
  const overall: { label: string; tone: Tone; icon: LucideIcon } = critical ? { label: `${critical} critical issue${critical > 1 ? "s" : ""}`, tone: "danger", icon: XCircle } : warnings ? { label: `${warnings} warning${warnings > 1 ? "s" : ""}`, tone: "warning", icon: AlertTriangle } : { label: "All checks passed", tone: "success", icon: CheckCircle2 };
  const r = data.runtime;
  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">IT workspace</p><h1 className="text-2xl font-bold">System Health</h1><p className="text-sm text-muted-foreground">Welcome, {employeeName}. Database, schema, access integrity and configuration{data.project ? ` for project ${data.project}` : ""}.</p></div>
      <span className={`tone-chip tone-${overall.tone} inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold`}><overall.icon className="size-4" />{overall.label}</span>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Database response" value={`${count(data.latencyMs)} ms`} note={`${data.latencyMs < 300 ? "Healthy" : data.latencyMs < 1000 ? "Slow; the database is busy or waking up" : "Very slow; check Supabase status"} · ${count(data.connections.used)} of ${count(data.connections.max)} connections`} icon={Activity} tone={data.latencyMs < 300 ? "success" : data.latencyMs < 1000 ? "warning" : "danger"} />
      <Tile label="Database size" value={`${data.capacity.percent}%`} note={`${megabytes(data.capacity.bytes)} of ${megabytes(data.capacity.limit)} (Supabase Free) · ${data.capacity.tableCount} tables`} icon={Database} tone={data.capacity.percent < 60 ? "success" : data.capacity.percent < 85 ? "warning" : "danger"} />
      <Tile label="Schema" value={data.schema.missing ? `${count(data.schema.missing)} missing` : "Up to date"} note={`${data.schema.applied} of ${data.schema.migrations} migrations · latest ${data.schema.latest}`} icon={Layers} tone={data.schema.missing ? "danger" : data.schema.applied < data.schema.migrations ? "warning" : "success"} />
      <Tile label="Active accounts" value={`${count(data.accounts.active)} / ${count(data.accounts.total)}`} note={`${count(data.accounts.activeEmployees)} active employees · ${count(data.issues.filter((issue) => issue.href).reduce((sum, issue) => sum + issue.items.length, 0))} access issues`} icon={UserCog} tone="info" href="/user-accounts" />
          </div>

    <Panel title="Schema, Access & Data Integrity" subtitle="Database columns checked against the code; accounts, roles and employees checked against each other">
      {data.issues.length ? <ul className="space-y-3">{data.issues.map((issue) => <li key={issue.title} className={`tone-${severityTone[issue.severity]} rounded-xl border p-3`}>
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2"><StatusBadge status={issue.severity === "critical" ? "Critical" : issue.severity === "warning" ? "Review" : "Info"} tone={severityTone[issue.severity]} /><strong className="text-sm">{issue.title}</strong><span className="text-sm text-muted-foreground">({issue.items.length})</span></span>
            {issue.href && <Link href={issue.href} className="text-sm font-medium text-primary hover:underline">Fix</Link>}
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">{issue.detail}</p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">{issue.items.map((item) => <li key={item} className="rounded-md bg-muted/60 px-2 py-1">{item}</li>)}</ul>
        </details>
      </li>)}</ul> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" />The database has every column the code uses, and every account has a role, matches an active employee, and agrees with the Employees register.</p>}
    </Panel>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Roles & Permissions" subtitle="Active users per role and what each role may do">
        <Table headers={["Role", "Users", "Manage users", "Attendance", "Reports", "Page access"]} rows={data.roles.map((role) => [<span key="n" className={role.active ? "font-medium" : "text-muted-foreground line-through"}>{role.name}</span>, count(role.users), <Flag key="u" on={role.manageUsers} />, <Flag key="a" on={role.manageAttendance} />, <Flag key="r" on={role.viewAttendanceReports} />, role.customPages ? "Custom" : "Default"])} />
        <p className="mt-3 text-xs text-muted-foreground">Changes to roles apply the next time affected users sign in. <Link href="/roles" className="text-primary hover:underline">Manage roles</Link></p>
      </Panel>
      <div className="space-y-6">
        <Panel title="Deployment Configuration" subtitle="Server settings the app needs; each must show a check. Database shows which Supabase project this deployment uses.">
          <ul className="space-y-2 text-sm">{data.config.map((item) => <li key={item.label} className="flex items-start justify-between gap-4"><span className="flex items-center gap-2">{item.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}{item.label}</span><span className="text-right text-muted-foreground">{item.detail}</span></li>)}</ul>
        </Panel>
        <Panel title="Sheets Layer Usage" subtitle={`Older modules reading through the Sheets layer (answered from the database), this server instance, last ${count(r.uptimeMinutes)} minutes`}>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[["Reads", r.reads], ["Writes", r.writes], ["Retries", r.retries], ["Failures", r.failures]].map(([label, value]) => <div key={label} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-bold tabular-nums">{count(Number(value))}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{r.lastFailure ? `Last failure: ${r.lastFailure}` : "No failed requests."} Reads are cached for 10 seconds to share one read within a page load; any save clears the cache.</p>
        </Panel>
      </div>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Largest Tables" subtitle="Space used including indexes; row counts are PostgreSQL estimates">
        <ul className="space-y-2">{data.capacity.tables.map((table) => <li key={table.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm"><span className="truncate font-medium">{table.name}</span><span className="tabular-nums text-muted-foreground">{count(table.rows)} rows · {megabytes(table.bytes)}</span><span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(1, (table.bytes / (data.capacity.tables[0]?.bytes || 1)) * 100)}%` }} /></span></li>)}</ul>
      </Panel>
      <Panel title="Recent Changes" subtitle="Latest edits and deletions from the Audit Log">
        <Table headers={["When", "Action", "Table", "Record", "By"]} rows={data.audit.map((entry) => [stamp(entry.at), <StatusBadge key="a" status={entry.action} tone={entry.action === "Deleted" ? "danger" : "info"} />, entry.table, entry.recordId, entry.by])} empty="No edits or deletions recorded yet." />
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
