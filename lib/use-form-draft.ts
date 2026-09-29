"use client";

import { useEffect, useRef } from "react";

const PREFIX = "dayong:draft:";

/**
 * Keeps an unsaved form when the clerk leaves the page and comes back (e.g. New Sales → Collections → New Sales).
 * The draft lives in this browser tab's sessionStorage: it survives navigation and refresh, not closing the tab,
 * and every draft is cleared on sign-out so the next person on a shared computer starts clean.
 * `snapshot` is what to save; `restore` puts a saved draft back into the page's state once, on arrival.
 */
export function useFormDraft<T>(key: string, snapshot: T, restore: (draft: T) => void) {
  const storageKey = PREFIX + key;
  const json = JSON.stringify(snapshot);
  const firstPass = useRef(true);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) restore(JSON.parse(saved) as T);
    } catch { /* storage blocked or an unreadable draft: start with an empty form */ }
    // Restore runs once per page visit; `restore` only calls state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    // Skip the first pass (the empty initial form) so it never overwrites the draft being restored.
    if (firstPass.current) { firstPass.current = false; return; }
    try { window.sessionStorage.setItem(storageKey, json); } catch { /* storage full or blocked: keep working without a draft */ }
  }, [storageKey, json]);
}

/** Forgets every saved form draft; called on sign-out. */
export function clearFormDrafts() {
  try {
    for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
  } catch { /* storage blocked: nothing to clear */ }
}
