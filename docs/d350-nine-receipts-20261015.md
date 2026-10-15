# Nine receipts corrected to D-350

The owner confirmed on October 15, 2026 that ORs 10706 C, 11445C, 13649 C, 14800 C, 15832 C, 18570 C, 20370 C, 21066 C, and 23764 C all belong to D-350 (`DP-0013`).

All nine belong to member `MEM-LEG-4BCE481ECA`. Eight were already on D-350 account `ENR-LEG-6FE523A298`. OR 14800 C (`COL-LEG-AE2599C9FA`) was on a separate erroneous DPB-350 account `ENR-LEG-A0801D6504`.

The existing `scripts/fix-legacy-receipts.mjs` was run against production with `--config=config/d350-nine-receipts-20261015.json`, first as a rolled-back dry run and then with `--apply`. It moved OR 14800 C to D-350, recalculated chronological coverage to NOP 40–48 (January–September 2026), and removed the emptied DPB-350 account after checking it had no remaining payments, transfers, or sales. The target account status recalculated from `90D` to `U`.

Each receipt remains PHP 350, totaling PHP 3,150. Receipt numbers, OR dates, and remittance values were preserved. A pre-correction snapshot is in `backups/`; Audit Log and Record Corrections retain the changes. Persistent per-row overrides for all nine M3-COLL source rows in `config/legacy-migration-map.json` point to `DP-0013`.

Read-only verification uses `scripts/correct-d350-receipts.mjs --receipts=10706C,11445C,13649C,14800C,15832C,18570C,20370C,21066C,23764C --expected-program-id=DP-0013 --expected-total=3150 --verify-histories`.
