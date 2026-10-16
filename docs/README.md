# Dayong System documentation

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
