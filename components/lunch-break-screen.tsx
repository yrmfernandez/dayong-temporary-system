"use client";

import { Clock, Utensils } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { isLunchBreak, lunchSecondsLeft, pageOpenDuringLunch, URGENT_FIX_MS } from "@/lib/lunch-break";

// The server's clock minus this computer's, so a wrong computer time does not open or close the break.
let offset = 0;
// An Administrator's urgent fix: the screen stays away until then (server time), across page changes.
let urgentUntil = 0;
async function syncClock() {
  try {
    const sent = Date.now();
    const result = await (await fetch("/api/server-time", { cache: "no-store" })).json() as { now?: number };
    if (typeof result.now === "number") offset = result.now - (sent + Date.now()) / 2;
  } catch { /* keep the last offset */ }
}

/**
 * Lunch Break (owner, October 28, 2026; lib/lunch-break.ts): from 12:00 to 12:59 PM Manila time a full-screen notice
 * covers every page except Attendance. It has no close button, the page under it cannot be clicked or typed into
 * (inert), and it goes away by itself at 1:00 PM; what was typed before stays. The server refuses saves meanwhile.
 * Administrators have Urgent fix: the screen goes away for 3 minutes and then comes back.
 */
export function LunchBreakScreen({ pathname, administrator }: { pathname: string; administrator: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    void syncClock().then(() => setNow(Date.now() + offset));
    const tick = window.setInterval(() => setNow(Date.now() + offset), 1000);
    const resync = window.setInterval(() => void syncClock(), 10 * 60 * 1000);
    return () => { window.clearInterval(tick); window.clearInterval(resync); };
  }, []);
  const lunch = now !== null && isLunchBreak(new Date(now));
  const shown = lunch && !pageOpenDuringLunch(pathname) && !(administrator && now < urgentUntil);

  // Everything else on the page ignores clicks, typing and focus while the screen is up.
  useEffect(() => {
    if (!shown) return;
    const others = [...document.body.children].filter((element) => !element.hasAttribute("data-lunch-break"));
    others.forEach((element) => element.setAttribute("inert", ""));
    return () => others.forEach((element) => element.removeAttribute("inert"));
  }, [shown]);

  if (!shown || now === null) return null;
  const left = lunchSecondsLeft(new Date(now));
  const minutes = Math.floor(left / 60), seconds = left % 60;
  return createPortal(
    <div data-lunch-break="" role="alertdialog" aria-modal="true" aria-labelledby="lunch-break-title" aria-describedby="lunch-break-text"
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-violet-950/95 p-6 text-white backdrop-blur-sm print:hidden">
      <div className="max-w-xl text-center">
        <Utensils className="mx-auto size-16 opacity-90" aria-hidden />
        <h1 id="lunch-break-title" className="mt-6 text-5xl font-black tracking-tight sm:text-7xl">LUNCH BREAK</h1>
        <p id="lunch-break-text" className="mt-4 text-lg opacity-90 sm:text-xl">12:00 PM – 1:00 PM. The system is closed for lunch and opens again at 1:00 PM.</p>
        <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-2xl font-bold tabular-nums" aria-live="off">
          <Clock className="size-6" aria-hidden />{minutes}:{String(seconds).padStart(2, "0")}
        </p>
        <p className="mt-6 text-sm opacity-80">Anything you were typing is kept. Clocking in or out still works:</p>
        <Link href="/attendance" className="mt-3 inline-block rounded-lg bg-white px-5 py-2.5 font-semibold text-violet-950 hover:bg-violet-100">Go to Attendance (clock in / out)</Link>
        {administrator && <div className="mt-8 border-t border-white/20 pt-5">
          <button type="button" className="rounded-lg border border-amber-300 bg-amber-400 px-5 py-2.5 font-semibold text-amber-950 hover:bg-amber-300" onClick={() => { urgentUntil = now + URGENT_FIX_MS; setNow(Date.now() + offset); }}>Urgent fix (Administrator)</button>
          <p className="mt-2 text-xs opacity-75">Use the system for 3 minutes; this screen comes back after that.</p>
        </div>}
      </div>
    </div>,
    document.body,
  );
}
