import { ReportTabs } from "@/components/report-tabs";

/** The signed-in Entry Clerk's own reports, one tab per period. */
export default function ReportsPage() {
  return (
    <section className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Your New Sales and Collections encoded in the period, as the company report. Only you and the reviewers see it.</p>
      </div>
      <ReportTabs />
    </section>
  );
}
