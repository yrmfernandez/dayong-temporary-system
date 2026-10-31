/**
 * Saves still waiting for the server (owner, October 31, 2026): when the database pooler is full, a save waits in line
 * on the server (inTransaction in lib/db.ts) instead of failing, and the page says so until it is saved. This counts
 * every request to the app's own /api routes that changes something (any method but GET and HEAD). Installed once in
 * the browser by the app shell; components/save-queue-notice.tsx shows the message.
 */
const listeners = new Set<() => void>();
const pending = new Map<number, number>();
let nextId = 0;

const notify = () => listeners.forEach((listener) => listener());

/** When the oldest save still waiting was sent (ms since epoch), or 0 when none is waiting. */
export function oldestPendingSave() {
  let oldest = 0;
  for (const startedAt of pending.values()) if (!oldest || startedAt < oldest) oldest = startedAt;
  return oldest;
}

export function onSaveQueueChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const isOwnSave = (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const request = input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return false;
    const url = new URL(request ? request.url : String(input), window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch { return false; }
};

export function installSaveQueue() {
  if (typeof window === "undefined") return;
  const marked = window as Window & { dayongSaveQueue?: boolean };
  if (marked.dayongSaveQueue) return;
  marked.dayongSaveQueue = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isOwnSave(input, init)) return original(input, init);
    const id = ++nextId;
    pending.set(id, Date.now());
    notify();
    return original(input, init).finally(() => { pending.delete(id); notify(); });
  };
}
