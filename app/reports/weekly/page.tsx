"use client";

import { ClerkReport } from "@/components/clerk-report";

/** The signed-in Entry Clerk's own weekly report: what they encoded, in the company's report layout. */
export default function WeeklyReportPage() {
  return (
    <section className="space-y-4">
      <div className="print:hidden"><h1 className="text-2xl font-bold">Weekly Report</h1><p className="text-sm text-muted-foreground">Your New Sales and Collections encoded in the period, as the company report. Only you and the reviewers see it.</p></div>
      <ClerkReport kind="weekly" />
    </section>
  );
}
