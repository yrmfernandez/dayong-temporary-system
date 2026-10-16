# Incentives follow corrected programs

On October 15, 2026, the owner requested that changing an entry's program also update its incentives so reports remain accurate.

Entry edits and program transfers recalculate affected Collections and New Sales from the corrected program, NOPs, branch, collection role and incentive tiers. Renumbered collections are recalculated too. Missing or conflicting incentive tiers stop the transaction. Existing forfeitures remain forfeited. Linked remittance lines and expected totals follow the new company share; actual cash received, gross payments and Fidelity are preserved. Saved audit/report approval snapshots are historical records and are not rewritten.

The maintenance scripts `consolidate-member-receipts.mjs`, `fix-legacy-receipts.mjs` and `move-program-accounts.mjs` now recalculate financial entries within the same transaction using `lib/entry-finance.mjs`.

## Production backfill

Scope: the seven accounts corrected in this session, specified in `config/corrected-entry-finance-20261015.json`. A reviewed production dry run was followed by `scripts/reprice-corrected-entries.mjs --config=config/corrected-entry-finance-20261015.json --apply` through `scripts/prod.mjs`.

- Checked 55 posted collections, including five newer payments; no New Sales existed on these accounts.
- Updated 50 entries: 49 had no stored company share; one existing share changed by PHP 32.50. Five newer entries already matched.
- Gross payments remain PHP 27,030. Correct incentives total PHP 6,218 and company share PHP 20,812 across all 55 entries.
- Linked slip `REM-20261015053634-I97E` now expects PHP 2,562.50, with actual cash still PHP 2,530 and difference PHP -32.50. This exposes the cash shortfall instead of changing recorded cash to balance it.
- Financial before/after values are in Record Corrections and Audit Log. A local financial backup without member personal fields is in `backups/`.
- A second production dry run found zero remaining financial changes, the same gross total, and no further slip adjustments.

Validation: TypeScript passed; targeted lint passed with four existing unused-variable warnings in the legacy receipt script. Regression tests passed for entry edits, program transfers, missing-tier rollback, branch overrides, tier boundaries, Collector ORC, DTO, reactivation, forfeiture, New Sale incentives, preserved actual cash/Fidelity, and repeat-run idempotence.

Earlier correction notes stating that incentives and remittance figures were preserved describe the initial corrections. This backfill supersedes that behavior.
