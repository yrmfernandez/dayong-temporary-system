# PH-44391390 DPB-420 consolidation

Owner confirmed October 14, 2026: receipts 5193 M, 6453 M, 8177 M, 8478 M, 6079 B, 8037 B, 11127 B, 12585 B and 14341 B belong to DPB-420. All nine belong to PH-44391390. March–May were on a separate D-420 account; June–September had been shifted back three covered months on DPB-420.

Applied to staging and production with `scripts/consolidate-member-receipts.mjs` after successful dry runs. The three D-420 receipts moved to DPB-420 (DP-0017), enrollment ENR-LEG-08B13371DB, retaining DOI 2025-07-01. All nine now cover January–September 2026 in the supplied receipt-date order, NOP 7–15. The empty D-420 account ENR-LEG-1C77AC2E68 had no New Sale and was removed. No shared program definition was changed.

Receipt dates and PHP 420 per receipt were preserved (PHP 3,780 total); existing incentive/remittance values were retained. Status recalculated to U. A read-only production verification confirmed one account and all nine receipt keys, amounts, account/program links, covered months and NOPs. Changes are recorded in Audit Log and Record Corrections. The case is archived under `applied` in `config/receipt-consolidations.json`.
