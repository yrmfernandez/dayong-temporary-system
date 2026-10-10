import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CompanyReports } from "@/components/company-reports";
import { ReportTabs } from "@/components/report-tabs";
import { dashboardKind } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { ACTIVE_ROLE_COOKIE } from "@/lib/ui-preferences";

/**
 * Reports. In the Administrator workspace: the company's own report (owner, October 10, 2026), since Entry Clerks'
 * reports are reviewed in Report Review. Everyone else (an Entry Clerk, or an administrator working as one): their own
 * reports, one tab per period.
 */
export default async function ReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  let preferred = "";
  try { preferred = decodeURIComponent((await cookies()).get(ACTIVE_ROLE_COOKIE)?.value ?? ""); } catch { /* ignore a malformed cookie */ }
  if (dashboardKind(user, preferred) === "admin") {
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
