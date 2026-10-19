# Source-confirmed coverage follow-up — October 19, 2026

The owner requested another scan and repair of cases similar to PH-88243657. Expanded the existing source audit to explicit 2025 arrears and source-covered month counts, rather than relying on stored NOP spans. Production snapshot: 14,228 accounts, 64,108 posted receipts, 62,424 indexed source rows. Fixed five accounts after full backups and rollback dry runs; 13 receipt month/NOP ranges changed. All 37 receipt dates and amounts (PHP 11,280 total), programs, enrollment dates, branch/MAS attribution and remittance links/status were preserved.

| Member | Program | Correction | Final coverage / NOP | Status | Receipt total |
| --- | --- | --- | --- | --- | ---: |
| PH-10533517 | D-210 HG | OR 24862 C PHP 420 covers August–September, not August only. | November 2025–September 2026 / 16–26 | Updated | PHP 2,310 |
| PH-50599167 | D-190 | OR 23600 C PHP 380 covers August–September, NOP 73–74; source repeated 73. | January–September 2026 / 66–74 | Updated | PHP 1,710 |
| PH-80857861 | D-210 HG | OR 06766T PHP 420 covers July–August, NOP 31–32; source only recorded NOP 31. | January–August 2026 / 25–32 | Updated | PHP 1,680 |
| PH-97019970 | D-180 | OR 06164T PHP 360 covers July–August, NOP 81–82; OR 08021T continues September–October, NOP 83–84. | January–October 2026 / 75–84 | Updated | PHP 1,800 |
| PH-70844674 | D-210 HG | Seven PHP 420 receipts each cover one source month, January–July; PHP 840 OR 15617 B covers August–November. Imported extra months through May 2027 removed. | January–November 2026 / 27–37 | Advance | PHP 3,780 |

## Source evidence

Original workbook: `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx`.

- PH-10533517: M3-COLL row 16196 explicitly August, September. Earlier source rows 769,3278,5969,6322,9078,10671,14958 confirm the continuous preceding history. November–December 2025 on OR 10195 C remains unchanged.
- PH-50599167: M3-COLL row 15798 explicitly August, September; source NOP 73,73 was a duplicate-number typo.
- PH-80857861: DAVNOR-COLL row 8018 explicitly July, August, with PHP 420.
- PH-97019970: DAVNOR-COLL row 6892 explicitly July, August (NOP field incorrectly contains amount 360); row 8822 explicitly September, October/NOP 83,84.
- PH-70844674: M1-COLL rows 636,1806,3056,4080,5290,6997,8316 specify one month each January–July; row 10026 specifies August, September, October, November/NOP 34–37. Existing November 2023 DOI implies January NOP 27; later source NOPs independently confirm that alignment.

## Safeguards and validation

Every included source row matched deterministic legacy ID, normalized receipt number, receipt date and amount. Complete source histories must be continuous, have at least six receipts and only one member account. At least 80% of later source NOP ranges must independently agree with the preserved DOI. Previously corrected accounts and ambiguous/incomplete sources were excluded. Exact source month counts are used; flexible-program amounts do not automatically imply additional months.

The existing consolidation script applied two scoped configurations: `config/ph10533517-two-month-receipt-20261019.json` and `config/four-source-span-fixes-20261019.json`. Fresh backups were saved through `member-accounts.mjs --backup`. All 37 financial snapshots were recalculated, with no net incentive changes and no linked remittance expectations updated. Audit Log and Record Corrections retain each repair.

`scripts/verify-source-span-fixes-20261019.mjs` passed production readback against the complete source plans and pre-change backups: exact covered months/NOPs, statuses, receipt counts/totals, preserved dates/program/DOI/attribution/remittance links, and correction records. Three parser regression tests and script syntax checks passed.

Read-only scans: `npm run prod -- node scripts/audit-source-month-coverage.mjs --prior-year` and `--source-spans`. Full receipt evidence is retained in the local ignored `legacy-data/source-cross-year-review-20261019.json` and `legacy-data/source-span-review-20261019.json`. The broader January-only Month of repair remains documented separately in `docs/source-month-corrections-20261019.md`.
