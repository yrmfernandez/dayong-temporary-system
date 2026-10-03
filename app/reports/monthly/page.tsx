"use client";

import { ClerkReport } from "@/components/clerk-report";

/** The signed-in Entry Clerk's own monthly report: what they encoded, in the company's report layout. */
export default function MonthlyReportPage() {
  return (
    <section className="space-y-4">
      <div className="print:hidden"><h1 className="text-2xl font-bold">Monthly Report</h1><p className="text-sm text-muted-foreground">Your New Sales and Collections encoded in the period, as the company report. Only you and the reviewers see it.</p></div>
      <ClerkReport kind="monthly" />
    </section>
  );
}
