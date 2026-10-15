# Six receipts confirmed as D-350

The owner confirmed on October 15, 2026 that ORs 10943C, 14675 C, 15365 C, 17109 C, 19622 C, and 21675 C all belong to D-350 (`DP-0013`).

All six were found under the same member. Five already belonged to D-350 account `ENR-LEG-492B031C0F`; OR 15365 C (`COL-LEG-5EA4036C54`) was on a separate DPB-350 account `ENR-LEG-E9F3748773`.

The existing `scripts/fix-legacy-receipts.mjs` now accepts a scoped `--config` and avoids Google Sheets when no pending receipts are configured. The correction in `config/d350-receipt-correction-20261015.json` was tested by a transaction rolled back, then applied in production. It moved OR 15365 C to D-350, recalculated chronological coverage, and removed the erroneous DPB-350 account after checking it had no remaining payments, transfers, or sales. Audit Log and Record Corrections retain the changes; a pre-correction snapshot is in `backups/`.

| Receipt | Final NOP | Final coverage |
| --- | --- | --- |
| 10943C | 39–41 | December 2025–February 2026 |
| 14675 C | 42 | March 2026 |
| 15365 C | 43 | April 2026 |
| 17109 C | 44–45 | May–June 2026 |
| 19622 C | 46 | July 2026 |
| 21675 C | 47 | August 2026 |

The six receipts still total PHP 3,150; amounts, receipt numbers, dates, and remittance values were preserved. D-350 account status recalculated from `120D` to `U` on October 15, 2026.

All six original M3-COLL row references have persistent D-350 overrides in `config/legacy-migration-map.json`. `scripts/correct-d350-receipts.mjs --verify` checks the six receipt assignments, continuous NOP coverage, and unchanged total without exposing member personal details.
