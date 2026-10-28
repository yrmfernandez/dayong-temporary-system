/** The server's clock, so the Lunch Break screen (components/lunch-break-screen.tsx) does not trust the computer's time. */
export function GET() {
  return Response.json({ success: true, now: Date.now() }, { headers: { "Cache-Control": "private, no-store" } });
}
