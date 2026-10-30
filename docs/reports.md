# Reports

Updated October 6, 2026. Formulas and worked examples are in [system guide § 10](system-guide.md#10-reports-mam-soa-and-executive-dashboard).

## Entry Clerk reports (`/reports`)

Reports are per Entry Clerk, not company-wide: each clerk sees only the New Sales and Collections they encoded, in the company's Daily, Weekly, Monthly, and Yearly Report layout. The four periods are tabs on one page (`/reports?tab=weekly`); the old `/reports/daily`…`/reports/yearly` addresses redirect to their tab.

| Part | Content |
| --- | --- |
| Header | Company name, address, SEC Reg No., logo, report name, Branch, Entry Clerk, Date + Week. |
| New Sales / Collections | Accts, Gross, Inc, Net, Fid/bond, Penalty. Rows by MAS (daily), date (weekly), week of the month (monthly), month (yearly). |
| Expenses / Other Cash Out | Posted expenses the clerk encoded in the period. |
| Cash Flow Transaction | Cash the clerk forwarded to the bank (`Bank Deposits`). Daily and weekly list each deposit; monthly shows one total per week and yearly one per month, with the bank accounts, transfer types, MAS and the number of deposits (October 20, 2026). Deposits are edited or voided on the daily or weekly report. |
| Cash summary | Cash Beg/Pending COH, Sales Net, Collection Net, Fidelity Bond, Penalty, Pending cash to be encoded, Total Cash In; Expenses, Cash forwarded to bank, Total Cash Out; Remaining Cash on Hand; TOTALS. |
| Remarks | Specific Rmks, Pending Transactions, Other Comments (`Report Notes`). |
| Summary sheet | Weekly, monthly, yearly: New Member and Collection by Marketing Account Staff. CVE columns are shown but not yet defined. |
| Checks | Remitted and not-yet-remitted shares, penalties, forfeited incentives, receipt photos, date warnings, and every entry with its details, filtered by New Sales or Collections, Remitted / Returned / missing receipt photo, OR or application number, MAS and program. |

Entries count by the date the clerk encoded them. Weeks run Monday to Sunday but stay inside the month (since October 30, 2026): week 1 starts on the 1st and runs to the first Sunday, and the last week ends on the month's last day. October 2026 is WEEK 1 Oct 1-4, WEEK 2 Oct 5-11, WEEK 3 Oct 12-18, WEEK 4 Oct 19-25, WEEK 5 Oct 26-31; a month can have 6 weeks. The weekly report, its audit, This week on Reports and My Entries all use these weeks ([report-week.ts](../lib/report-week.ts)). Cash Beg is what the clerk types for that report (zero when none), case by case; nothing is carried from earlier periods (since October 13, 2026).

On their own report a clerk records expenses (saved to Expenses for their primary branch, so Finance sees them; each needs at least one photo of its receipt, viewed with **Receipt** on the report, October 21, 2026), cash forwarded to the bank (voided with a reason, never deleted), and the report notes.

Report sheets and the MAS summary use theme-aware surfaces and text for readable light and dark modes. Colored section headings keep contrasting text. Printing from either theme uses white sheets with dark text and readable column headings. This shared layout also applies in Report Review and Audits ([component](../components/clerk-report.tsx), [print styles](../app/globals.css)).

## Report Review (`/admin-reports`) and Audits

Report Review shows the same tabs for any Entry Clerk, read-only, with the entry checklist and reviewer remarks. Audits open the same report for the audited clerk and period, and the audit figures come from it.

## Other report data

The company-wide operational builder (`lib/reports.ts`, `/api/reports`) no longer has its own screen. It still feeds dashboards and the earned-commission comparison, and stores report remarks. Its date bases and formulas are in the system guide.

Live reports are not snapshots: corrections to a source entry appear the next time the report loads. Approved audits keep the figures they were approved with.

## Statement of Account (`/soa`)

One member program enrollment, printable. Layout: header (company, branch, Date, account ID); Member and Account blocks (program, category, MAS, DOI, application no., monthly due); Payment History; Summary (account status, total paid, program balance, amount due now, paid through, next due, months behind); signature lines for Prepared by and Collection Department Head.

| Status | Item |
| --- | --- |
| Done | Program category, program balance, Summary section, Prepared by and Collection Department Head signature lines, department head setting for administrators and IT. |
| In progress | Browser check and test print of the new layout. |
| To do | None yet. |
