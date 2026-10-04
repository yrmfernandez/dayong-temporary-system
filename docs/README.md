# Dayong System documentation

Reviewed against repository code on **October 4, 2026**. Start with the [system guide](system-guide.md): it explains daily operations, calculations with examples, how records connect, staff permissions, setup, and current limitations.

| Read this | When you need it |
| --- | --- |
| [System guide](system-guide.md) | Understand how the whole system works; main review document. |
| [Code reference](code-reference.md) | Find source files, exported functions/types/constants, API methods, dependencies, and every maintenance script. |
| [Project context](project-context.md) | Review the history of confirmed business decisions and implementation changes. |
| [Original specification](dayong-system-specification.md) | Historical user-supplied baseline; includes planned rules, superseded requirements, and examples. |

The new system guide describes current code. The older feature documents below remain useful context, but some contain superseded statements. In particular, first Collection NOP is now 2, New Sales have configurable incentives, Fidelity has a PHP 10,000 locked portion rather than a lifetime contribution cap, and period audits store approval snapshots. Do not treat an old specification or prose statement as proof that a feature is implemented.

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
| Reporting | [Operational reports](reports.md), [executive dashboard](executive-dashboard.md) |
| Database maintenance | [Migration readiness](database-migration-readiness.md) |
| Hosting and performance | [Deployment performance](deployment-performance.md) |

## Keeping documentation current

When a business rule changes, update the matching system-guide section with its source link and example. Run `node scripts/generate-code-reference.mjs` from the repository root to refresh the source inventory, and update that script's review date when doing a new review. Confirm actual workbook headers separately; this documentation scan does not connect to the live database or verify migrations.
