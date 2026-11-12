"use client";

import { Megaphone } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime as showDateTime } from "@/lib/date-format";

export type PopupUpdate = { id: string; title: string; summary: string; steps: number; announcedAt: string; announcedBy: string };
const WAIT_SECONDS = 5;

/**
 * The pop-up of a System Update IT announced (lib/system-updates.ts, November 12, 2026): it cannot be closed for 5
 * seconds, so it is read. "Go to updates" opens the update's step-by-step guide on /updates. Either marks it seen.
 */
export function UpdatePopup({ update, onDone, onGuide, preview = false }: { update: PopupUpdate; onDone: () => void; onGuide: (id: string) => void; preview?: boolean }) {
  const [left, setLeft] = useState(WAIT_SECONDS);
  useEffect(() => {
    // A new update starts its own 5 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeft(WAIT_SECONDS);
    const timer = window.setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearInterval(timer);
  }, [update.id]);

  async function mark(action: "seen" | "opened") {
    // IT's preview on /updates marks nothing.
    if (preview) return;
    try { await fetch("/api/updates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: update.id }) }); } catch { /* shown again next time */ }
  }

  const locked = left > 0;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="update-popup-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl">
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Megaphone className="size-5" /></span>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">System update</p>
          <h2 id="update-popup-title" className="text-lg font-bold leading-snug">{update.title}</h2>
          <p className="text-xs text-muted-foreground">{update.announcedBy ? `From ${update.announcedBy}` : "From IT"}{update.announcedAt ? ` · ${showDateTime(update.announcedAt)}` : ""}</p>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{update.summary}</p>
      {update.steps > 0 && <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">Go to updates for a {update.steps}-step guide that takes you to each page where it changed.</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={locked} aria-live="polite" onClick={() => { void mark("seen"); onDone(); }}>{locked ? `Close (${left})` : "Close"}</Button>
        <Button type="button" onClick={() => { void mark("opened"); onGuide(update.id); }}>Go to updates</Button>
      </div>
    </div>
  </div>;
}
