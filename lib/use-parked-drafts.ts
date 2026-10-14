"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "dayong:parked:";

export type ParkedDraft<T> = { id: string; label: string; savedAt: string; data: T };

/**
 * Batches set aside to finish later (owner, October 14, 2026: leave a batch for a moment and go on with other entries).
 * Kept in this browser's localStorage, so they survive closing the tab; cleared on sign-out with the other drafts
 * (lib/use-form-draft.ts clearFormDrafts), so the next person on a shared computer starts clean.
 */
export function useParkedDrafts<T>(key: string) {
  const storageKey = PREFIX + key;
  const [drafts, setDrafts] = useState<Array<ParkedDraft<T>>>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage after mount
      if (saved) setDrafts(JSON.parse(saved) as Array<ParkedDraft<T>>);
    } catch { /* storage blocked or unreadable: no drafts */ }
  }, [storageKey]);

  const write = useCallback((next: Array<ParkedDraft<T>>) => {
    setDrafts(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }, [storageKey]);

  const park = useCallback((label: string, data: T) => {
    const draft: ParkedDraft<T> = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, savedAt: new Date().toISOString(), data };
    write([draft, ...drafts]);
  }, [drafts, write]);

  const remove = useCallback((id: string) => write(drafts.filter((draft) => draft.id !== id)), [drafts, write]);

  /** Takes a draft out of the list (to resume it) and, when given, sets the open batch aside in the same step. */
  const swap = useCallback((id: string, current?: { label: string; data: T }) => {
    const taken = drafts.find((draft) => draft.id === id);
    const rest = drafts.filter((draft) => draft.id !== id);
    write(current ? [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: current.label, savedAt: new Date().toISOString(), data: current.data }, ...rest] : rest);
    return taken?.data;
  }, [drafts, write]);

  return { drafts, park, remove, swap };
}

/** Forgets every set-aside batch; called on sign-out. */
export function clearParkedDrafts() {
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  } catch { /* storage blocked: nothing to clear */ }
}
