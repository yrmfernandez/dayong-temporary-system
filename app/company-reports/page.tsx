import { CompanyReports } from "@/components/company-reports";

/**
 * Company Reports (owner, October 10, 2026): every branch's New Sales and Collections for a period, the cash picture
 * and breakdowns (components/company-reports.tsx). Administrators, CEO and President by default; other roles when
 * granted in Roles → Page access. Each Entry Clerk's own report stays on Reports, and is reviewed in Report Review.
 */
export default function CompanyReportsPage() {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Company Reports</h1>
        <p className="text-sm text-muted-foreground">Every branch&apos;s New Sales and Collections for the period, the cash picture, and breakdowns by branch, program, MAS / Collector, day and Entry Clerk. Each Entry Clerk&apos;s own report is in Report Review.</p>
      </div>
      <CompanyReports />
    </section>
  );
}
