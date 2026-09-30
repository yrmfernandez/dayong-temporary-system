/**
 * Fixed-window attempt counter held in server memory. Each server instance keeps its own counts, so on Vercel this
 * slows password guessing rather than capping it exactly; a shared store (e.g. Upstash Redis) makes it exact.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

function sweep(now: number) {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

/** Seconds until `key` may try again, or 0 when it is under `limit` attempts in the current window. */
export function retryAfter(key: string, limit: number) {
  const window = windows.get(key), now = Date.now();
  if (!window || window.resetAt <= now || window.count < limit) return 0;
  return Math.ceil((window.resetAt - now) / 1000);
}

export function recordAttempt(key: string, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const window = windows.get(key);
  if (!window || window.resetAt <= now) windows.set(key, { count: 1, resetAt: now + windowMs });
  else window.count += 1;
}

export function clearAttempts(key: string) {
  windows.delete(key);
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
