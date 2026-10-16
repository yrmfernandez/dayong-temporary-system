# PH-58645726 coverage starts January 2026

Owner confirmed October 16, 2026 that January is the first covered month for these eight D-300 (Bracketing) receipts. Existing DOI September 1, 2025 makes January NOP 5. The two PHP 600 receipts each cover two months; the six PHP 300 receipts cover one month each.

| Receipt | Correct coverage | NOP |
| --- | --- | --- |
| 10063 C | January–February 2026 | 5–6 |
| 13790 C | March–April 2026 | 7–8 |
| 3582 B | May 2026 | 9 |
| 15912 C | June 2026 | 10 |
| 16860 C | July 2026 | 11 |
| 19758 C | August 2026 | 12 |
| 21591 C | September 2026 | 13 |
| 22189 C | October 2026 | 14 |

A pre-change backup was saved with the existing member-account inspection script. The consolidation script ran through `scripts/prod.mjs` with `--config=config/ph58645726-january-coverage-20261016.json`, first as a rolled-back dry run and then with `--apply`.

Account `ENR-LEG-D9A587D91E` retains program `DP-0067`, DOI, receipt dates and PHP 3,000 total. Coverage shifts from December 2025–September 2026/NOP 4–13 to January–October 2026/NOP 5–14. All eight financial entries were recalculated; no linked slip needed adjustment. Stored account status updated from `60D` to `U`. Changes are retained in Audit Log and Record Corrections.

Post-commit verification checked eight receipts, expected program and unchanged total, and validated the full payment history. A repeat dry run checked for remaining financial changes.

## Owner-confirmed NOP exception

The owner subsequently stated that NOP starts at 4 and explicitly confirmed keeping September 1, 2025 as DOI while January 2026 remains NOP 4. This supersedes the DOI-derived NOPs above; coverage stays January–October.

The scoped config now records `startNop: 4`, `coverageStart: "2026-01"`, `expectedDoi: "2025-09-01"` and the owner's exception. The consolidation script accepts an explicit coverage start only with an expected DOI and reason; the default DOI-derived behavior is unchanged.

Applied after a rolled-back dry run: 10063 C NOP 4–5, 13790 C NOP 6–7, and the six remaining receipts NOP 8, 9, 10, 11, 12 and 13. All eight financial entries were recalculated; total incentive increased PHP 84, with no linked slip adjustment. DOI, January–October coverage, receipt dates and PHP 3,000 gross stay unchanged. Status remains `U`. This intentionally differs from the default DOI/NOP alignment and is documented in Record Corrections and Audit Log.
