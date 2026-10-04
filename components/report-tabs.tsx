"use client";

import { BarChart3, Calendar, CalendarDays, CalendarRange } from "lucide-react";
import { useEffect, useState } from "react";

import { ClerkReport } from "@/components/clerk-report";

type Kind = "daily" | "weekly" | "monthly" | "yearly";

const TABS: Array<{ id: Kind; label: string; icon: typeof CalendarDays; description: string }> = [
  { id: "daily", label: "Daily", icon: CalendarDays, description: "One day, by MAS." },
  { id: "weekly", label: "Weekly", icon: CalendarRange, description: "Monday to Sunday, by date." },
  { id: "monthly", label: "Monthly", icon: Calendar, description: "One month, by week." },
  { id: "yearly", label: "Yearly", icon: BarChart3, description: "One year, by month." },
];
const isKind = (value: string | null): value is Kind => TABS.some((tab) => tab.id === value);

/**
 * Daily, Weekly, Monthly and Yearly reports as tabs on one page, like Remittances. The open tab is kept in the address
 * (?tab=weekly) so a link or a refresh opens the same report. `review` lets the viewer choose the Entry Clerk.
 */
export function ReportTabs({ review = false }: { review?: boolean }) {
  const [kind, setKind] = useState<Kind>("daily");

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address after mount
    if (isKind(tab)) setKind(tab);
  }, []);

  const choose = (next: Kind) => {
    setKind(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border-b print:hidden">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Report period">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={kind === id} onClick={() => choose(id)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${kind === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground print:hidden">{TABS.find((tab) => tab.id === kind)?.description}</p>
      {/* A new report per tab, so each keeps its own period input. */}
      <ClerkReport key={kind} kind={kind} review={review} />
    </div>
  );
}
