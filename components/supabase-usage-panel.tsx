import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/date-format";
import type { SupabaseUsage } from "@/lib/supabase-usage";

const USAGE_PAGE = "https://supabase.com/dashboard/org/_/usage";
const count = (value: number) => value.toLocaleString("en-PH");
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString("en-PH", { maximumFractionDigits: 1 })} GB` : `${(bytes / 1024 / 1024).toLocaleString("en-PH", { maximumFractionDigits: 1 })} MB`;
/** Green, then amber from 80% of the allowance, red past it: the point of the panel is to see this before October 31 repeats. */
const barColor = (percent: number) => percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary";

/** Supabase Usage on System Health: what can be measured here, and a link for what only Supabase knows (lib/supabase-usage.ts). */
export function SupabaseUsagePanel({ usage }: { usage: SupabaseUsage }) {
  const { server, readers, cycle } = usage;
  const peak = Math.max(1, ...usage.daily.map((day) => day.bytes));
  const figures: [string, string, string][] = server ? [
    ["CPU load", server.cpuPercent === null ? "—" : `${server.cpuPercent}%`, "Last 5 minutes"],
    ["Memory", server.memoryPercent === null ? "—" : `${server.memoryPercent}%`, server.memoryBytes === null ? "" : `of ${size(server.memoryBytes)}`],
    ["Disk", server.diskPercent === null ? "—" : `${server.diskPercent}%`, server.diskBytes === null ? "" : `of ${size(server.diskBytes)}`],
    ["Read from memory", server.cacheHitPercent === null ? "—" : `${server.cacheHitPercent}%`, "Rest comes from disk"],
  ] : [];
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><CardTitle>Supabase Usage</CardTitle><p className="text-xs text-muted-foreground">Billing cycle {formatDate(cycle.start)} to {formatDate(cycle.end)}. Measured by this system; the billed amounts are on Supabase.</p></div>
        <a href={USAGE_PAGE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary/10">Open Supabase Usage<ExternalLink className="size-3.5" /></a>
      </div>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Egress (estimate)</p>
          {usage.total === null
            ? <p className="mt-1 text-sm text-muted-foreground">{server ? "Starts after the next Nightly Jobs run, which takes the first reading." : "Could not read the server's figures."}</p>
            : <>
              <p className="text-xl font-bold tabular-nums">{size(usage.total)} <span className="text-sm font-normal text-muted-foreground">of {size(usage.limit)} ({usage.percent}%)</span></p>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${barColor(usage.percent)}`} style={{ width: `${Math.min(100, Math.max(1, usage.percent))}%` }} /></span>
              <p className="mt-1 text-xs text-muted-foreground">{usage.since > cycle.start ? `Since ${formatDate(usage.since)}, not the whole cycle. ` : ""}{usage.pace === null ? "Pace shown after 3 days of readings." : `On pace for about ${size(usage.pace)} this cycle.`}</p>
            </>}
          <p className="mt-1 text-xs text-muted-foreground">The database server&apos;s traffic out, for this project only. It is not the billed figure, so compare it with Supabase&apos;s; the allowance covers every project in the organization.</p>
        </div>
        <div>
          <p className="text-sm font-medium">Realtime broadcasts sent</p>
          <p className="text-xl font-bold tabular-nums">{usage.broadcasts === null ? "—" : count(usage.broadcasts)} <span className="text-sm font-normal text-muted-foreground">last 24 hours</span></p>
          <p className="mt-1 text-xs text-muted-foreground">{count(usage.cycleBroadcasts)} recorded this cycle. Supabase also counts each delivery to an open tab, so its Realtime Messages figure is higher.</p>
        </div>
      </div>

      {figures.length > 0 && <dl className="grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">{figures.map(([label, value, note]) => <div key={label} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-bold tabular-nums">{value}</dd>{note && <dd className="text-xs text-muted-foreground">{note}</dd>}</div>)}</dl>}

      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Traffic out per day</p>
          {usage.daily.length ? <ul className="mt-2 space-y-1.5">{usage.daily.map((day) => <li key={day.date} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs"><span className="text-muted-foreground">{formatDate(day.date)}</span><span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(1, (day.bytes / peak) * 100)}%` }} /></span><span className="text-right tabular-nums">{size(day.bytes)}</span></li>)}</ul>
            : <p className="mt-1 text-sm text-muted-foreground">Shown after two nightly readings.</p>}
        </div>
        <div>
          <p className="text-sm font-medium">Biggest readers</p>
          {readers ? <>
            <ul className="mt-2 space-y-1">{readers.tables.map((table) => <li key={table.table} className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{table.table}</span><span className="shrink-0 tabular-nums text-muted-foreground">{table.share}% · {count(table.rows)} rows · {count(table.calls)} reads</span></li>)}</ul>
            <p className="mt-2 text-xs text-muted-foreground">Rows sent to the app per table{readers.since ? ` since ${formatDateTime(readers.since)}` : ""}. Rows are what egress is made of, so fix the top of this list first.</p>
          </> : <p className="mt-1 text-sm text-muted-foreground">Not available on this database.</p>}
        </div>
      </div>

      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><strong className="font-medium text-foreground">Only on Supabase&apos;s Usage page:</strong> billed Egress, Cached Egress, billed Realtime Messages, Realtime Peak Connections, Logs Query and Logs Ingest. Its public API does not give these out.</p>
    </CardContent>
  </Card>;
}
