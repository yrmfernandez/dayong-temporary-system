"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_MAINTENANCE_MESSAGE, MAINTENANCE_MESSAGE_MAX, type MaintenanceNotice } from "@/lib/maintenance-notice-text";

const stamp = (value: string) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** System Health: IT turns the maintenance notice on for everyone while updating, and off when done. */
export function MaintenanceNoticePanel({ notice: initial }: { notice: MaintenanceNotice }) {
  const [notice, setNotice] = useState(initial);
  const [text, setText] = useState(initial.on ? initial.message : DEFAULT_MAINTENANCE_MESSAGE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(on: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/maintenance-notice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on, message: text }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the notice.");
      setNotice(result.notice); setMessage(result.message);
      // The banner in this tab updates at once; other users' tabs follow within seconds.
      window.dispatchEvent(new Event("notifications:refresh"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save the notice."); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="size-4 text-primary" />Maintenance Notice</CardTitle>
      <p className="text-xs text-muted-foreground">Turn it on before updating the system or adjusting the database: every signed-in user sees it at the top of every page, so slowness or errors during the work are expected. Turn it off when done.</p></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm">{notice.on ? <><strong className="text-amber-700 dark:text-amber-400">On</strong> since {stamp(notice.startedAt)}{notice.by ? ` · by ${notice.by}` : ""}</> : <strong className="text-muted-foreground">Off</strong>}</p>
      <label className="block text-sm font-medium">Message everyone sees
        <textarea className="mt-1 min-h-20 w-full rounded-md border bg-background p-2 text-sm font-normal" maxLength={MAINTENANCE_MESSAGE_MAX} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void save(true)}>{notice.on ? "Update notice" : "Turn on for everyone"}</Button>
        {notice.on && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(false)}>Turn off</Button>}
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}
