"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EntryCorrectionForm } from "@/components/entry-correction-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parseJsonResponse } from "@/lib/api-response";
import type { ExceptionCategory, ExceptionItem } from "@/lib/exceptions";

type Category = { category: ExceptionCategory; label: string; total: number; items: ExceptionItem[] };
type Result = { success: boolean; message?: string; categories: Category[]; limit: number };

const HELP: Record<ExceptionCategory, string> = {
  dates: "OR or application dates that are not real dates, are in the future, or are before 2000. Usually a typo in the year.",
  sequence: "Dates that do not fit together: a receipt dated after the entry was recorded, cash remitted before the receipt or more than 7 days after it, entries encoded more than 30 days late, or a remittance slip dated differently from the entry.",
  amounts: "Collections that are not whole installments (more is allowed only when it pays the program off exactly), and New Sales on locked programs that differ from the fixed amount.",
  duplicates: "The same OR number or application number on two entries, or two member records with the same name and birthdate.",
  members: "Active members without a birthdate, contact number, or address.",
  overdue: "Cash still with the MAS or Collector after 10:00 AM the day after the OR date. The incentive is forfeited when it is remitted.",
  backdated: "Entries saved in the last 30 days with a date more than a day old, and the reason the clerk gave.",
};

export default function ExceptionsPage() {
  const [data, setData] = useState<Result | null>(null);
  const [category, setCategory] = useState<ExceptionCategory>("dates");
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [fixing, setFixing] = useState("");

  const load = useCallback(async (legacy: boolean) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/exceptions${legacy ? "?legacy=1" : ""}`, { cache: "no-store" });
      const result = await parseJsonResponse<Result>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to check for exceptions.");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to check for exceptions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load
    void load(false);
  }, [load]);

  const current = data?.categories.find((item) => item.category === category);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exceptions</h1>
          <p className="text-sm text-muted-foreground">Entries and records that look wrong, found automatically. Fix each one here or on the linked page; it disappears once it is right.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeLegacy} onChange={(event) => { setIncludeLegacy(event.target.checked); setFixing(""); void load(event.target.checked); }} />
            Include imported (legacy) records
          </label>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load(includeLegacy)}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Exception type">
        {(data?.categories ?? []).map((item) => (
          <Button key={item.category} type="button" role="tab" aria-selected={category === item.category} size="sm" variant={category === item.category ? "default" : "outline"} onClick={() => { setCategory(item.category); setFixing(""); }}>
            {item.label} <span className={`ml-1.5 tabular-nums ${item.total ? "" : "opacity-60"}`}>{item.total}</span>
          </Button>
        ))}
      </div>

      {message && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</p>}

      {current && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">{HELP[current.category]}{current.total > current.items.length ? ` Showing the newest ${current.items.length} of ${current.total}.` : ""}</p>
            {!current.items.length && <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Checking..." : "Nothing to fix here."}</p>}
            <ul className="divide-y rounded-lg border">
              {current.items.map((item) => (
                <li key={item.key} className="space-y-3 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{item.title}{item.legacy && <span className="ml-2 rounded bg-muted px-1.5 text-xs text-muted-foreground">legacy</span>}</p>
                      <p className="break-words text-sm text-muted-foreground">{item.problem}</p>
                    </div>
                    {item.entry
                      ? <Button type="button" size="sm" variant="outline" onClick={() => setFixing(fixing === item.key ? "" : item.key)}>{fixing === item.key ? "Close" : "Fix"}</Button>
                      : item.href && <Link href={item.href} className="inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted">Open</Link>}
                  </div>
                  {item.entry && fixing === item.key && (
                    <EntryCorrectionForm entry={item.entry} endpoint="/api/exceptions" onCancel={() => setFixing("")} onSaved={(text) => { setMessage(text); setFixing(""); void load(includeLegacy); }} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
