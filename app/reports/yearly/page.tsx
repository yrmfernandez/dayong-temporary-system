"use client";

import { ClerkReport } from "@/components/clerk-report";

/** The signed-in Entry Clerk's own yearly report: what they encoded, in the company's report layout. */
export default function YearlyReportPage() {
  return (
    <section className="space-y-4">
      <div className="print:hidden"><h1 className="text-2xl font-bold">Yearly Report</h1><p className="text-sm text-muted-foreground">Your New Sales and Collections encoded in the period, as the company report. Only you and the reviewers see it.</p></div>
      <ClerkReport kind="yearly" />
    </section>
  );
}
