"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { entryClosed } from "@/lib/remittance-deadline";

const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

function clockParts(now: Date) {
  const part = (type: string) => timeFormat.formatToParts(now).find((item) => item.type === type)?.value ?? "";
  return { date: dateFormat.format(now), hour: part("hour"), minute: part("minute"), second: part("second"), period: part("dayPeriod").toUpperCase() };
}

/**
 * Today's date and a live Manila clock for the top bar. The dot shows whether New Sales and Collections can still be
 * saved: green until the 3:00 PM cutoff, gold from then until midnight. Renders after mount, so server and browser
 * clocks never disagree during hydration; the empty pill keeps its width meanwhile.
 */
export function TopbarClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: number;
    // Tick on each new second rather than every 1000 ms from mount, so the seconds never lag the real clock.
    const tick = () => { setNow(new Date()); timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  const time = now ? clockParts(now) : null;
  const closed = now ? entryClosed() : false;
  const status = closed ? "Encoding closed until midnight" : "Encoding open until 3:00 PM";
  return (
    <div className="topbar-clock flex shrink-0 items-center gap-2.5 rounded-full py-1 pl-2.5 pr-3 text-xs" title={`Manila time · ${status}`}>
      <span className="hidden items-center gap-1.5 text-muted-foreground lg:flex">
        <CalendarDays className="size-3.5 text-brand-gold" aria-hidden />
        <span className="min-w-[6.5rem]">{time?.date}</span>
      </span>
      <span className="topbar-clock-divider hidden h-4 w-px lg:block" aria-hidden />
      <span className="flex items-center gap-2">
        <span className={`topbar-clock-dot ${closed ? "is-closed" : ""}`} aria-hidden />
        <time className="flex min-w-[5.6rem] items-baseline gap-0.5 font-semibold tabular-nums text-foreground" dateTime={now?.toISOString()} suppressHydrationWarning>
          {time && <>
            <span className="text-sm leading-none">{time.hour}<span className="topbar-clock-colon">:</span>{time.minute}</span>
            <span className="text-[0.7rem] leading-none text-muted-foreground">:{time.second}</span>
            <span className="ml-1 text-[0.62rem] font-bold leading-none tracking-wider text-brand-gold">{time.period}</span>
          </>}
        </time>
        <span className="sr-only">{status}</span>
      </span>
    </div>
  );
}
