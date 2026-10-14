# PH-56261777 payment coverage correction

Owner requested correction of nine receipts October 14, 2026. All are on D-210 HG (DP-0005), TORIL, account ENR-LEG-CF06CE419F, DOI 2023-12-01. Original source: `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx`, M1-COLL rows 382, 494, 2239, 3367, 4771, 6025, 7216, 8400, 9656.

The source's MONTH OF labels run December then January through August. Its NOPs run 25, 15, 27–33: January's 15 is inconsistent with its neighboring 25 and 27. Imported coverage instead ran February–October 2025, NOP 15–23. Corrected to December 2025–August 2026, NOP 25–33, which matches source month labels and the existing DOI.

| OR | Correct coverage | NOP |
| --- | --- | --- |
| 5188 M | December 2025 | 25 |
| 3130 M | January 2026 | 26 |
| 7458 M | February 2026 | 27 |
| 8387 M | March 2026 | 28 |
| 6279 B | April 2026 | 29 |
| 8016 B | May 2026 | 30 |
| 9574 B | June 2026 | 31 |
| 12551 B | July 2026 | 32 |
| 14321 B | August 2026 | 33 |

Applied on staging and production with `scripts/consolidate-member-receipts.mjs` after successful dry runs. Configuration archived under `applied` in `config/receipt-consolidations.json`. Original receipt dates and PHP 210 per receipt were preserved (PHP 1,890 total). Status recalculated to U under the current account rules. A read-only production check verified every member/account/program link, amount, month and NOP. Changes are in Audit Log and Record Corrections. No workbook changes were made.
