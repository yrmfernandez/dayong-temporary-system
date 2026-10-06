# Reports

Updated October 6, 2026. Formulas and worked examples are in [system guide § 10](system-guide.md#10-reports-mam-soa-and-executive-dashboard).

## Entry Clerk reports (`/reports`)

Reports are per Entry Clerk, not company-wide: each clerk sees only the New Sales and Collections they encoded, in the company's Daily, Weekly, Monthly, and Yearly Report layout. The four periods are tabs on one page (`/reports?tab=weekly`); the old `/reports/daily`…`/reports/yearly` addresses redirect to their tab.

| Part | Content |
| --- | --- |
| Header | Company name, address, SEC Reg No., logo, report name, Branch, Entry Clerk, Date + Week. |
| New Sales / Collections | Accts, Gross, Inc, Net, Fid/bond. Rows by MAS (daily), date (weekly), week of the month (monthly), month (yearly). |
| Expenses / Other Cash Out | Posted expenses the clerk encoded in the period. |
| Cash Flow Transaction | Cash the clerk forwarded to the bank (`Bank Deposits`). |
| Cash summary | Cash Beg/Pending COH, Sales Net, Collection Net, Fidelity Bond, Pending cash to be encoded, Total Cash In; Expenses, Cash forwarded to bank, Total Cash Out; Remaining Cash on Hand; TOTALS. |
| Remarks | Specific Rmks, Pending Transactions, Other Comments (`Report Notes`). |
| Summary sheet | Weekly, monthly, yearly: New Member and Collection by Marketing Account Staff. CVE columns are shown but not yet defined. |
| Checks | Remitted and not-yet-remitted shares, penalties, forfeited incentives, receipt photos, date warnings, and every entry with its details. |

Entries count by the date the clerk encoded them. Weeks run Monday to Sunday. Cash Beg carries the clerk's Remaining Cash on Hand from before the period; pending cash is not carried.

On their own report a clerk records expenses (saved to Expenses for their primary branch, so Finance sees them), cash forwarded to the bank (voided with a reason, never deleted), and the report notes.

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
