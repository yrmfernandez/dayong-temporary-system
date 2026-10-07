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

function connect() {
  if (channel || typeof window === "undefined") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  channel = client.channel("db-changes", { config: { private: false } })
    .on("broadcast", { event: "change" }, ({ payload }) => {
      const table = typeof payload?.table === "string" ? payload.table : "";
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
    let timer: number | undefined, stale = false;
    const run = () => { timer = undefined; if (document.hidden) { stale = true; return; } void reloadRef.current(); };
    const listener: Listener = (table) => { if (watched.has(table) && timer === undefined) timer = window.setTimeout(run, delayMs); };
    const onVisible = () => { if (!document.hidden && stale) { stale = false; void reloadRef.current(); } };
    connect();
    listeners.add(listener);
    document.addEventListener("visibilitychange", onVisible);
    return () => { listeners.delete(listener); document.removeEventListener("visibilitychange", onVisible); if (timer !== undefined) window.clearTimeout(timer); };
  }, [key, delayMs]);
}
