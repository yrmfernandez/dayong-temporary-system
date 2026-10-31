"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An editor or detail area that opens directly under the item it belongs to, like an accordion, instead of at the
 * top or bottom of the page. On open it scrolls only as far as needed to be fully visible (usually not at all) and
 * puts the cursor in its first field.
 */
export function InlinePanel({ children, className, focus = true }: { children: ReactNode; className?: string; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (focus) panel.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])")?.focus({ preventScroll: true });
  }, [focus]);
  return <div ref={ref} className={cn("rounded-lg border border-primary/30 bg-primary/5 p-4 duration-150 animate-in fade-in-0 slide-in-from-top-1", className)}>{children}</div>;
}

/**
 * InlinePanel as a full-width table row under the row being edited. `stack`: in a table whose rows become cards on a
 * phone (block below md, as on Members), the panel row stacks the same way.
 */
export function InlineRow({ colSpan, children, className, stack = false }: { colSpan: number; children: ReactNode; className?: string; stack?: boolean }) {
  return <tr className={stack ? "block md:table-row" : undefined}><td colSpan={colSpan} className={stack ? "block p-2 md:table-cell" : "p-2"}><InlinePanel className={className}>{children}</InlinePanel></td></tr>;
}
