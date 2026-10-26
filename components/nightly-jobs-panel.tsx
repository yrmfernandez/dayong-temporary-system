"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Moon, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NightlyRun } from "@/lib/nightly-jobs";
import { formatDateTime as showDateTime } from "@/lib/date-format";

const stamp = (value: string) => value ? showDateTime(value) : "—";
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The last nightly run (lib/nightly-jobs.ts) on System Health, with Run now for IT. */
export function NightlyJobsPanel({ run: initial, scheduled, checkedAt }: { run: NightlyRun | null; scheduled: boolean; checkedAt: string }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Older than about a day and a half when the page was loaded: the schedule did not fire last night.
  const late = !run || Date.parse(checkedAt) - Date.parse(run.finishedAt) > 36 * 3600 * 1000;

  async function runNow() {
    setBusy(true); setMessage("Running... this can take up to a minute.");
    try {
      const response = await fetch("/api/cron/nightly", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to run the nightly jobs.");
      setRun(result.run); setMessage(result.message); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to run the nightly jobs."); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Moon className="size-4 text-primary" />Nightly Jobs</CardTitle>
      <p className="text-xs text-muted-foreground">Every night after 12:00 AM Manila: system absences for finished days, account statuses, and the Exceptions count. {scheduled ? "Scheduled by Vercel Cron." : "Not scheduled: CRON_SECRET is not set on the server, so only Run now works."}</p></CardHeader>
    <CardContent className="space-y-3">
      {run ? <>
        <p className="flex flex-wrap items-center gap-2 text-sm">{run.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}<strong>Last run {stamp(run.finishedAt)}</strong><span className="text-muted-foreground">· {run.trigger}</span>{late && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900">More than a day ago</span>}</p>
        <ul className="space-y-1.5 text-sm">{run.steps.map((item) => <li key={item.name} className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-1.5">{item.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}<span><strong>{item.name}</strong> · {item.detail} <span className="text-xs text-muted-foreground">({seconds(item.ms)})</span></span></li>)}</ul>
      </> : <p className="text-sm text-muted-foreground">Never run yet.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runNow()}>{busy ? "Running..." : "Run now"}</Button>{message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}</div>
    </CardContent>
  </Card>;
}
