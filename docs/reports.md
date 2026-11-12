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

Entries count by the date the clerk encoded them.

**Weekly and monthly reports are submitted by the clerk (since October 30, 2026; [report-periods.ts](../lib/report-periods.ts)):**

- **Weekly:** the clerk chooses up to which day (today at the latest). It starts the day after their last weekly ended, so no day is left out or counted twice; the first one starts on a day they choose. They check it and **Submit**. A submitted weekly is locked for them (no expense, deposit, Fidelity, Cash Beg or notes on any of its days) until the audit returns it.
- **Returned:** HR, Finance or an Administrator returns a submitted report on Audits with a reason. The clerk sees the reason, fixes the report and presses **Submit again**, which locks it again. **Since November 12, 2026** a returned weekly's days can be changed (**Change days**) before submitting it again: **From** only on the clerk's first weekly (otherwise it stays the day after the previous one), **To** only on their latest (otherwise it stays the day before the next one), so no day is left out or counted twice. Its notes and Cash Beg move with its first day; HR saves the audit again for the new days.
- **Approved:** HR or Finance saves the audit and an Administrator approves it, as for daily audits. An Administrator can still allow editing an approved report.
- **Week number (since November 12, 2026):** each weekly belongs to the month most of its days fall in (Sep 28 - Oct 4 is October) and is **Week 1, 2, 3…** of that month in the order the clerk submitted them. While choosing the days, the picker shows **This will be Week N of Month**; the report heading reads `WEEK 2 OF OCTOBER 2026 · OCTOBER 5-11, 2026`. A weekly already in a monthly keeps that monthly's month; one after the last monthly is never put in that month or earlier.
- **Monthly (since November 12, 2026):** exactly one month: the weeklies of the first month not yet in a monthly, Week 1 to the last, listed by week number. It can be submitted once those weeklies reach the month's last day (or a weekly of a later month exists) and every one of them is approved. Before, the clerk picked the last weekly and a monthly could mix two months.
- The Weekly and Monthly tabs list the clerk's submitted reports with their status (Submitted, Returned, Approved) and **New weekly report** / **New monthly report**; weeklies show as `Week 2 of October 2026 · Oct 5 – Oct 11, 2026`.
- **Audits → Weekly (since November 12, 2026):** pick the **Month** and the **Week** (Week 1 to 6) instead of a date; each clerk's Week N of that month is listed, and clerks without one are named under Not submitted.

Daily and yearly reports keep calendar dates. **This week** on Reports and My Entries is still Monday to Sunday within the month ([report-week.ts](../lib/report-week.ts)). Cash Beg is what the clerk types for that report (zero when none), case by case; nothing is carried from earlier periods (since October 13, 2026).

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
