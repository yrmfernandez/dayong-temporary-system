import { BREAK_END, BREAK_START } from "@/lib/attendance";

/**
 * Lunch break lock (owner, October 28, 2026): from 12:00 to 12:59 PM Manila time nobody, Administrators included, can
 * use the system. Every page shows a Lunch Break screen that cannot be closed and goes away by itself at 1:00 PM
 * (components/lunch-break-screen.tsx), and the server refuses every save (proxy.ts) except clocking in or out and
 * signing in or out. An Administrator's Urgent fix (owner, the same day) hides the screen for 3 minutes, then it comes
 * back; the server takes Administrators' saves. The hours are the attendance lunch break (lib/attendance.ts).
 */
const manilaClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const minutesOf = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };

/** Seconds after Manila midnight. */
function manilaSeconds(now: Date) {
  const parts = manilaClock.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return part("hour") * 3600 + part("minute") * 60 + part("second");
}

export const isLunchBreak = (now = new Date(Date.now())) => {
  const seconds = manilaSeconds(now);
  return seconds >= minutesOf(BREAK_START) * 60 && seconds < minutesOf(BREAK_END) * 60;
};

/** Seconds left until the break ends (0 outside it). */
export const lunchSecondsLeft = (now = new Date(Date.now())) => (isLunchBreak(now) ? minutesOf(BREAK_END) * 60 - manilaSeconds(now) : 0);

/** APIs that still take saves during the break: clocking in or out, and signing in or out. */
const LUNCH_ALLOWED_API = new Set(["/api/attendance", "/api/auth/login", "/api/auth/logout"]);
export const allowedDuringLunch = (pathname: string) => LUNCH_ALLOWED_API.has(pathname);
/** Pages usable during the break (the screen is not shown there): Attendance, to clock in or out. */
export const pageOpenDuringLunch = (pathname: string) => pathname === "/attendance";

/** How long an Administrator's Urgent fix hides the screen before it comes back. */
export const URGENT_FIX_MS = 3 * 60 * 1000;

export const LUNCH_BREAK_MESSAGE = "Lunch break (12:00 PM – 1:00 PM): nothing can be saved until 1:00 PM. Clocking in or out still works.";
