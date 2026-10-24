# Dayong System documentation

**October 24, 2026: one time zone.** Every report and on-screen date is the Manila date; a sale saved just after midnight in Manila is no longer counted on the day before in the Company report (upgrade #7). See the [system guide](system-guide.md) (implementation limits, item 7).

**October 24, 2026: every save by ID.** Remittances, attendance, leave, user accounts and the last small modules now save directly in the database by ID, in one step or one transaction; two approvers can no longer decide the same slip twice. Only reads still use the older Sheets-style layer (upgrade #6 complete). See the [system guide](system-guide.md) (implementation limits, item 9).

**October 24, 2026: upgrade #6 complete.** Period audits, holidays and non-working days, system settings, roles and report remarks now save directly by ID, in one step or one transaction (phase 4, after payroll, clerk report cash and finance). Attendance records, leave and sign-in accounts still use the older layer; see the [system guide](system-guide.md) (implementation limits, item 9).

**October 24, 2026: finance saves by ID in one step.** Expenses, Cash Transactions, vendor bills, commissions and cash accounts are saved directly; a payment and its cash outflow save together, and a vendor bill can no longer be overpaid by two payments at once (upgrade #6, phase 3). See [finance](finance.md).

**October 24, 2026: company program deductions waiting for a Collection.** Payroll lists membership deductions of paid payrolls until Finance links the Collection that put the money on the member account. Needs migration 0028. See [payroll](payroll.md).

**October 24, 2026: clerk report cash saves in one step.** Bank deposits, Notes and Cash Beg are saved directly by ID; the same deposit reference saved twice at once is refused, and Notes or Cash Beg saved twice at once keep one row (upgrade #6, phase 2).

**October 24, 2026: payroll saves in one transaction.** Every payroll action now saves completely or not at all, and Mark paid can no longer record the payroll twice (upgrade #6, phase 1). See [payroll](payroll.md).

**October 24, 2026: program pay locked once paid.** A program's Base Pay, flexible payments and registration fee required can no longer change after it has collections, so old receipts are never read at a new rate; a new price is a new program. See the [system guide](system-guide.md) (implementation limits, item 2).

**October 24, 2026: Member Corrections.** A new page for IT and Administrators fixes a member's records without a script: fix coverage, move receipts, insert a missing receipt, merge two members, split a member; each previews the exact result and saves with a reason. See the [system guide](system-guide.md) section 12.

**October 24, 2026: status clock from Month of.** Waiver, 60D–150D and Forfeited count from the last covered month on the OR date's day (paid October 10 for July: 60D and Waiver from September 10, Forfeited January 11). See the [system guide](system-guide.md) status rules; preview the effect with `scripts/preview-month-of-status-rule.mjs`.

**October 24, 2026: payouts leave the cash ledger.** Vendor bill payments, commissions paid directly and Fidelity withdrawals now record their cash outflow with the payment (cash account, branch, date). See [finance](finance.md) and the [system guide](system-guide.md) (implementation limits, item 5).

**October 24, 2026: nightly jobs.** Every night after midnight Manila the system records absences for finished days, updates account statuses and counts the Exceptions; IT → System Health shows the last run and has Run now. Needs `CRON_SECRET` on Vercel. See the [system guide](system-guide.md) (implementation limits, item 11).

**October 24, 2026: clock-in location check.** Branches can have their office location saved (Branches → Branch locations for clock-in, set one branch at a time); clock-ins away from the branch or with location off are flagged for HR on the Daily board and in Attendance Review. Needs migration 0027 on production before deploying. See the [system guide](system-guide.md#attendance-and-calendar) and the agreed [upgrade list](project-context.md#upgrade-list-agreed-2026-10-24-done-one-at-a-time).

The [October 21 receipt 12665 B correction](receipt-12665b-review-20261021.md) restores the missing receipt to PH-77690372 and applies owner-confirmed August/NOP 23 and September/NOP 24 coverage to two existing payments.

The [October 21 PH-77690372 correction](ph77690372-source-correction-20261021.md) restores eight source remittance dates, recalculates eight financial snapshots and refreshes status while preserving the DOI/NOP-confirmed coverage.

The [October 21 PH-53228425 receipt-date correction](ph53228425-receipt-dates-20261021.md) confirms both 5364 M and duplicate-marked 5367 M already exist, and corrects their remittance dates to the owner-provided values.

The [October 21 PH-53228425 verification](ph53228425-verification-20261021.md) confirms all five receipts, coverage/NOPs, status and financial figures; no database change was needed after resolving a source-cell formatting issue.

The [October 21 PH-43187023 correction](ph43187023-source-correction-20261021.md) restores nine source-backed receipt month/NOP spans while retaining the audited program assignment and recalculating financial snapshots/status.

The [October 21 receipt 03407 S import](receipt-03407s-import-review-20261021.md) adds the source-confirmed receipt to owner-confirmed PH-74827073, with financial, history and audit verification.

The [October 21 other-program audit](other-program-source-repairs-20261021.md) checks 12,806 accounts across 46 programs using aggregate-only scripts, corrects two receipt-month histories and refreshes 973 additional statuses.

The [October 21 Bracketing source audit](bracketing-source-repairs-20261021.md) scans 1,462 accounts, corrects 75 NOPs across 31 histories and refreshes 251 additional statuses, with a separate list of histories requiring review.

The [October 21 PH-02795415 Bracketing correction](ph02795415-bracketing-20261021.md) restores April–September NOP 2–7, aligns the DOI with the March 31 New Sale and updates account status.

The [October 21 PH-46732266 / PH-95168214 merge](ph46732266-ph95168214-merge-20261021.md) retains one person with D-210 HG and D-300 Bracketing and preserves all 15 receipts.

The [October 21 Rutchelyn report cleanup](rutchelyn-report-cleared-20261021.md) removes 13 leftover entries traced to six remittances already deleted by the administrator.

The [October 21 older Clearing correction](older-clearing-covers-20261021.md) fixes six lines ticked Both to their actual remitted kind; five approved lines can leave Clearing and one remains pending.

The [October 16 PH-47317014 verification](ph47317014-february-nop22-20261016.md) confirms February/NOP 22 for 4196 S and refreshes financial figures and account status.

The [October 16 PH-04464351 correction](ph04464351-january-nop31-20261016.md) sets January–August 2026 coverage at NOP 31–38.

The [October 16 PH-68531118 consolidation](ph68531118-all-d210hg-20261016.md) places all nine payments under D-210 HG and recalculates incentives.

The [October 16 PH-17113133 correction](ph17113133-january-nop22-20261016.md) sets January–September 2026 coverage at NOP 22–30.

The [October 16 PH-99032555 correction](ph99032555-january-nop27-20261016.md) sets January–September 2026 coverage at NOP 27–35.

The [October 16 OR 11420 B correction](or11420b-july-august-20261016.md) extends its PHP 840 payment to July–August 2026, NOP 50–51.

The [October 16 PH-72833261 correction](ph72833261-january-nop21-20261016.md) sets January–September 2026 coverage at NOP 21–29 for nine D-210 HG receipts.

The [October 16 PH-58645726 coverage correction](ph58645726-january-coverage-20261016.md) shifts eight D-300 (Bracketing) receipts to January–October 2026, NOP 5–14.

The [October 16 PH-61149554 coverage correction](ph61149554-d280-coverage-20261016.md) applies February–October 2026, NOP 31–39, to nine D-280 receipts.

The [October 16 old-web receipt import](web24029-24037-import-20261016.md) records the completed 24029 import and the program clarification needed for 24037.

The [October 16 eight-member consolidation](eight-same-pay-consolidations-20261016.md) applies the owner-confirmed same-base-pay program assignments and records the D-460 (59B) first-year incentive configuration gap.

The [October 16 five-receipt correction](five-receipt-program-moves-20261016.md) moves ORs 4382 S, 12008 B, 15945 B, 10926B and 08035T to the owner-confirmed programs and recalculates affected coverage and incentives.

The [October 16 OR 8574 M correction](or8574m-dpb420-20261016.md) moves the PHP 420 receipt to DPB-420 and recalculates affected coverage and incentives.

The [October 16 OR 5151 B correction](or5151b-d190-20261016.md) moves the PHP 380 receipt to D-190 and recalculates affected coverage and incentives.

The [October 16 OR 13743 C correction](or13743c-dpb350-20261016.md) moves the flagged duplicate receipt to DPB-350 and recalculates affected coverage and incentives.

The [October 16 D-460 correction](d460-seven-receipts-20261016.md) consolidates seven receipts onto D-460 and recalculates their coverage and incentives.

The [October 15 incentive correction](corrected-entry-finance-20261015.md) makes incentives follow corrected programs and NOPs, and backfills the seven accounts corrected in this session.

The [October 15 PH-24556150 program merge](ph24556150-dfpp650-merge-20261015.md) consolidates nine payments onto the member's correct DFPP-650 account.

The [October 15 six-receipt D-210 HG verification and coverage correction](d210hg-six-receipts-20261015.md) confirms the program and applies the owner's September 2025–July 2026 coverage, NOP 6–16.

The [October 15 DAVNOR-NS timestamp verification](davnor-ns-row150-verification-20261015.md) confirms the requested October 10 enrollment is already in production.

Reviewed against repository code on **October 4, 2026**. Start with the [system guide](system-guide.md): it explains daily operations, calculations with examples, how records connect, staff permissions, setup, and current limitations.

October 9 updates (no migration needed):
See also the [October 15 CINDE CALUMBAY correction](cinde-calumbay-mas-correction-20261015.md): seven existing member accounts and sales linked to the owner-confirmed MAS.
The [October 15 CONDES, MILDRED verification](mildred-condes-mas-verification-20261015.md) confirms the existing MAS and 22 linked member accounts, including the old-sheet records.
The [October 15 D-350 receipt correction](d350-receipt-correction-20261015.md) places six owner-confirmed receipts on one D-350 account with continuous payment coverage.
The [October 15 dual-program receipt verification](dual-program-receipts-20261015.md) confirms ten receipts are correctly split between D-210 HG and D-300 (Bracketing).
The [October 15 DPB-350 receipt correction](dpb350-receipt-correction-20261015.md) consolidates nine owner-confirmed receipts on DPB-350 with January–September 2026 coverage.
The [October 15 nine-receipt D-350 correction](d350-nine-receipts-20261015.md) moves OR 14800 C from DPB-350 so all nine listed receipts belong to D-350.
The [October 15 D-300 (Bracketing)/D-350 correction](d300-d350-receipts-20261015.md) verifies nine receipts per program and marks the intended 13601C receipt `(to be checked)`.
The [October 15 two-receipt D-350 correction](d350-two-receipts-20261015.md) puts ORs 13646 C and 14797 C on the same D-350 account.

- **Clearing:** New Sales and Collections pick the MAS **From Clearing**, which fills in Branch, MAS and Date Remitted; a MAS listed in Clearing is no longer missed (branch case, an earlier Date Remitted, two employees with the same name). Each Clearing line follows its entries (Waiting for encoding → Waiting for receipt → For approval → Approved, or Returned) and leaves the page after 11:59 PM only once approved.
- **Attendance:** the daily board and Attendance Review mark many employees at once (select all or ticked); Attendance Review marks one by one from a **Mark as** dropdown; new **No attendance needed** mark for employees such as MAS who do not clock in.
- **Programs and accounts:** D-290 (500) and a duplicate DSP-290 entry move into D-290 or DSP-290 by DOI (`scripts/move-program-accounts.mjs`, which can now merge an account into the member's existing one); impossible DOIs such as 1943 are replaced with the OR or remittance date (`scripts/fix-impossible-doi.mjs`). Both run on production with `npm run prod --`, dry run first. See [project context](project-context.md).

October 6 updates cover report readability in dark mode, Day Off in attendance tracking, and optional maximum monthly payments on flexible programs. The monthly maximum requires migration `0009_program_monthly_maximum` before deployment; see the [migration plan](supabase-migration-plan.md).

| Read this | When you need it |
| --- | --- |
| [System guide](system-guide.md) | Understand how the whole system works; main review document. |
| [Code reference](code-reference.md) | Find source files, exported functions/types/constants, API methods, dependencies, and every maintenance script. |
| [Project context](project-context.md) | Review the history of confirmed business decisions and implementation changes. |
| [Original specification](dayong-system-specification.md) | Historical user-supplied baseline; includes planned rules, superseded requirements, and examples. |

The new system guide describes current code. The older feature documents below remain useful context, but some contain superseded statements. In particular, first Collection NOP is now 2, New Sales have configurable incentives, Fidelity has a PHP 10,000 locked portion rather than a lifetime contribution cap, period audits store approval snapshots, remittance slips are created automatically once receipt photos are attached (Entry Clerks no longer build or approve slips), and Reports are per Entry Clerk in the company report layout rather than one company-wide operational report. Do not treat an old specification or prose statement as proof that a feature is implemented.

## Existing topic documents

| Topic | Document |
| --- | --- |
| Login roles and page access | [Access control](access-control.md) |
| Record editing/deletion policies | [CRUD policy](crud-policy.md) |
| Collection and cash-turnover flow | [Collections and remittances](collections-remittance-workflow.md) |
| Encoder identity | [Encoder tracking](encoder-tracking.md) |
| Account monitoring | [MAM implementation](mam-implementation.md), [UI reference](mam-ui-reference.md) |
| Cash and expenses | [Finance](finance.md) |
| Staff savings | [Fidelity](fidelity.md) |
| Employee pay | [Payroll](payroll.md) |
| Reporting | [Entry Clerk reports](reports.md), [executive dashboard](executive-dashboard.md) |
| Database maintenance | [Migration readiness](database-migration-readiness.md), [Supabase migration plan](supabase-migration-plan.md) (in progress: status by module, what is done and still to do) |
| Hosting and performance | [Deployment performance](deployment-performance.md) |

## Keeping documentation current

When a business rule changes, update the matching system-guide section with its source link and example. Run `node scripts/generate-code-reference.mjs` from the repository root to refresh the source inventory, and update that script's review date when doing a new review. Confirm actual workbook headers separately; this documentation scan does not connect to the live database or verify migrations.
