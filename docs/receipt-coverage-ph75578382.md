# PH-75578382 D-280 coverage correction

Owner requested correction October 14, 2026 for nine receipts in the supplied order: 5458 M, 6479 M, 8175 M, 3808 B, 6066 B, 8043 B, 11138 B, 13341 B, 14334 B. All belong to D-280, DP-0066, enrollment ENR-LEG-BE770ABABA, DOI 2023-05-01.

Original workbook `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx`, M1-COLL rows 507, 1701, 2704, 3945, 5068, 6246, 7708, 9364, 9709, has conflicting first two month/NOP labels and July NOP 29. March–June and August–September consistently show NOP 35–38 and 40–41. With the existing DOI and supplied January–September receipt order, the consistent sequence is NOP 33–41 (July 39). Imported coverage instead ran September 2025–May 2026, NOP 29–37.

Applied to production with `scripts/consolidate-member-receipts.mjs` after a successful production dry run. Staging had no account in the production program ID and was skipped without changing records. Receipt dates and PHP 280 per receipt were preserved (PHP 2,520 total); program and ownership were unchanged. Coverage is January–September 2026, NOP 33–41; status recalculated to U. A read-only production verification checked all receipt keys, account/program links, amounts, months and NOPs. Changes are in Audit Log and Record Corrections. The case is archived in `config/receipt-consolidations.json`.
