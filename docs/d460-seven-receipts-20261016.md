# Seven receipts corrected to D-460

On October 16, 2026, the owner confirmed ORs 4507 M, 8027 M, 9708 M, 7010 B, 7040 B, 10183 B and 15058 B all belong to D-460.

Production inspection found all seven on member PH-99982893. OR 8027 M (PHP 920) was on D-420 (`DP-0018`, account `ENR-LEG-0EBCCA2068`); the other six were on D-460 (`DP-0023`, account `ENR-LEG-B0849AB5B5`). Both accounts had DOI December 1, 2024. Neither had a New Sale or transfer history.

A pre-change backup was saved using `scripts/member-accounts.mjs PH-99982893 --show-payments --backup`. The existing `scripts/consolidate-member-receipts.mjs` was run through `scripts/prod.mjs` with `--config=config/d460-seven-receipts-20261016.json`, first as a rolled-back dry run and then with `--apply`.

OR 8027 M moved onto the existing D-460 account. The emptied D-420 account was removed. All seven financial entries were recalculated from D-460's incentives and corrected NOPs; no linked remittance expectation needed adjustment. Gross amounts and receipt dates were preserved, totaling PHP 4,140. Account status recalculated to `U`.

| Receipt | Coverage | NOP |
| --- | --- | --- |
| 4507 M | January 2026 | 14 |
| 8027 M | February–March 2026 | 15–16 |
| 9708 M | April 2026 | 17 |
| 7010 B | May 2026 | 18 |
| 7040 B | June 2026 | 19 |
| 10183 B | July 2026 | 20 |
| 15058 B | August–September 2026 | 21–22 |

Audit Log and Record Corrections retain the changes. Verification checks receipt count, program, account, gross total and complete payment history; a repeat dry run checks that financial figures no longer need changes.
