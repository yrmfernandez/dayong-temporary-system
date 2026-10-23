"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

/**
 * Live updates. The database broadcasts {"table": "<name>"} on the public Realtime channel "db-changes" after every
 * insert, update or delete (db/migrations/0010_realtime_changes.sql). A page lists the tables it shows and reloads its
 * data through its usual route when one of them changes, so every user's access rules still apply and no record ever
 * travels on the channel.
 *
 * One connection per browser tab, shared by every page. Changes are gathered for a moment (one reload for a burst of
 * saves), and a hidden tab reloads when it is shown again instead of in the background. Without
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY the hook does nothing and pages work as before.
 */
type Listener = (table: string) => void;
const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
/** When the last broadcast arrived (any table): none for a while means Realtime may not be delivering. */
let lastBroadcastAt = 0;
/**
 * Fallback (owner, October 23, 2026: a changed record sometimes did not show in an open report). Production's Realtime
 * dropped broadcasts ("no partition of relation messages found"), so pages also reload when the tab is shown again or
 * the window regains focus, and every POLL_MS while visible when no broadcast has arrived for QUIET_MS.
 */
const POLL_MS = 60_000, QUIET_MS = 120_000, FOCUS_GAP_MS = 15_000;

function connect() {
  if (channel || typeof window === "undefined") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  channel = client.channel("db-changes", { config: { private: false } })
    .on("broadcast", { event: "change" }, ({ payload }) => {
      const table = typeof payload?.table === "string" ? payload.table : "";
      lastBroadcastAt = Date.now();
      if (table) for (const listener of listeners) listener(table);
    })
    .subscribe();
}

/**
 * Calls `reload` when any of `tables` changes (database table names, e.g. "collections", "remittances"). `reload`
 * should refresh lists and totals only, never reset a form the user is filling in.
 */
export function useLiveRefresh(tables: string[], reload: () => unknown, delayMs = 1200) {
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);
  const key = tables.join(",");

  useEffect(() => {
    const watched = new Set(key.split(",").filter(Boolean));
    let timer: number | undefined, stale = false, reloadedAt = Date.now();
    const reload = () => { reloadedAt = Date.now(); void reloadRef.current(); };
    const run = () => { timer = undefined; if (document.hidden) { stale = true; return; } reload(); };
    const listener: Listener = (table) => { if (watched.has(table) && timer === undefined) timer = window.setTimeout(run, delayMs); };
    // Shown again or focused: reload if a change was missed while hidden, or if the last reload is a while ago.
    const onVisible = () => { if (document.hidden) return; if (stale || Date.now() - reloadedAt > FOCUS_GAP_MS) { stale = false; reload(); } };
    const poll = window.setInterval(() => { if (!document.hidden && Date.now() - lastBroadcastAt > QUIET_MS && Date.now() - reloadedAt >= POLL_MS) reload(); }, POLL_MS);
    connect();
    listeners.add(listener);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { listeners.delete(listener); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); window.clearInterval(poll); if (timer !== undefined) window.clearTimeout(timer); };
  }, [key, delayMs]);
}
