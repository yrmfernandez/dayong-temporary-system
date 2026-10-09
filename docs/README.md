# Dayong System documentation

Reviewed against repository code on **October 4, 2026**. Start with the [system guide](system-guide.md): it explains daily operations, calculations with examples, how records connect, staff permissions, setup, and current limitations.

October 9: Attendance Tracking's daily board can mark many employees at once (select all or ticked) and has a new **No attendance needed** mark for employees such as MAS who do not clock in; no migration needed.

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
