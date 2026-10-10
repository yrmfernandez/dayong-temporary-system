/**
 * When a request fails before the app can answer (Vercel's time limit, a crash, a gateway error), the server sends a
 * plain-text page such as "An error occurred with your deployment", and a page calling response.json() showed
 * "Unexpected token 'A', "An error o"... is not valid JSON" (October 10, 2026). This makes every page's response.json()
 * on the app's own /api routes explain it plainly instead. Installed once in the browser by the app shell.
 */
export function explainServerFailure(status: number, body: string) {
  const text = body.slice(0, 400);
  if (status === 504 || /TIMEOUT|timed out|took too long/i.test(text)) return "The server took too long to answer. Please try again in a moment; if it keeps happening, note the page and the time for IT.";
  if (status === 401 || status === 403) return "Your session may have expired. Sign in again and refresh this page.";
  if (status === 404) return "This part of the system is unavailable right now. Refresh the page.";
  if (status === 429) return "Too many requests at once. Please wait a moment and try again.";
  return `The server ran into a problem (${status || "no response"}). Please try again; if it keeps happening, note the page and the time for IT.`;
}

export function installFriendlyApiErrors() {
  if (typeof window === "undefined") return;
  const marked = Response.prototype as Response & { dayongFriendly?: boolean };
  if (marked.dayongFriendly) return;
  marked.dayongFriendly = true;
  const original = Response.prototype.json;
  Response.prototype.json = async function json(this: Response) {
    const own = (() => { try { const url = new URL(this.url, window.location.href); return url.origin === window.location.origin && url.pathname.startsWith("/api/"); } catch { return false; } })();
    if (own && !(this.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
      const body = await this.text().catch(() => "");
      throw new Error(explainServerFailure(this.status, body));
    }
    return original.call(this);
  };
}
