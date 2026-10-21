"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type { DayEndLine } from "@/lib/clearing";

const label = (kind: string) => (kind === "New Sales" ? "New Sales" : "Collections");

/**
 * Day-end review of Clearing (owner, October 21, 2026): the first time an Entry Clerk opens the system on a new day, their
 * own clearing lines of earlier days still on the Clearing list come up here, each to keep or to clear. Clearing a line
 * takes it off the list; anything already encoded from it stays recorded (lib/clearing.ts settleDayEnd). "Ask me later"
 * hides it until the next page load. People without Clearing get nothing (the API answers 403).
 */
export function ClearingDayEndPrompt() {
  const [lines, setLines] = useState<DayEndLine[]>([]);
  const [choice, setChoice] = useState<Record<string, "keep" | "clear">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/clearing?review=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((result: { success?: boolean; review?: DayEndLine[] } | null) => {
        const review = result?.success ? result.review ?? [] : [];
        setLines(review);
        // Clearing is the usual answer after the day; the clerk ticks Keep for a line still being worked on.
        setChoice(Object.fromEntries(review.map((line) => [line.id, "clear" as const])));
      })
      .catch(() => { /* the review is a convenience; pages work without it */ });
    return () => controller.abort();
  }, []);

  if (!lines.length && !done) return null;

  const save = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/clearing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "day-end", keep: lines.filter((line) => choice[line.id] === "keep").map((line) => line.id), clear: lines.filter((line) => choice[line.id] !== "keep").map((line) => line.id),
      }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save your answers.");
      setLines([]); setDone(result.message || "Saved.");
      // The sidebar number follows; the Clearing page reloads on its own (live updates).
      window.dispatchEvent(new Event("notifications:refresh"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save your answers."); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="day-end-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><CalendarClock className="size-4" /></span>
          <div className="min-w-0 space-y-1">
            <p id="day-end-title" className="font-semibold">{done ? "Clearing list updated" : "Your Clearing list from earlier days"}</p>
            <p className="text-sm text-muted-foreground">{done || "These lines are still on your Clearing list. Keep a line you are still working on; clear the rest. Clearing takes the line off the list: entries already encoded from it stay recorded, and what was not encoded can no longer be encoded from it."}</p>
          </div>
        </div>
        {!done && (
          <ul className="mt-4 divide-y rounded-xl border">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{line.employeeName} · {line.branch}</p>
                  <p className="text-xs text-muted-foreground">Cleared {line.clearedDate} · {line.kinds.map((part) => `${label(part.kind)}: ${part.encoded ? `${part.encoded} encoded, ${part.stage.toLowerCase()}` : "nothing encoded"}`).join(" · ")}</p>
                </div>
                <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`Keep or clear ${line.employeeName}, ${line.clearedDate}`}>
                  {(["keep", "clear"] as const).map((value) => (
                    <Button key={value} type="button" size="sm" role="radio" aria-checked={choice[line.id] === value} variant={choice[line.id] === value ? (value === "clear" ? "destructive" : "default") : "outline"}
                      onClick={() => setChoice((current) => ({ ...current, [line.id]: value }))}>{value === "keep" ? "Keep" : "Clear"}</Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {done ? <Button type="button" size="sm" onClick={() => setDone("")}>OK</Button> : <>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setLines([])}>Ask me later</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setChoice(Object.fromEntries(lines.map((line) => [line.id, "keep" as const])))}>Keep all</Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : `Save (${lines.filter((line) => choice[line.id] !== "keep").length} to clear)`}</Button>
          </>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
