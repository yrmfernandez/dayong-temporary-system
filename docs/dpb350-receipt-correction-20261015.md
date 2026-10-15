# Nine receipts confirmed as DPB-350

On October 15, 2026, the owner confirmed ORs 9242 C, 10941C, 13585 C, 9860 M, 15387 C, 17105 C, 19617 C, 21670 C, and 22139 C all belong to DPB-350 (`DP-0010`, whose stored program code is `350`).

All nine belong to member `MEM-LEG-352C0C9743`. Five were already on DPB-350 account `ENR-LEG-6072D271E5`. Four (9242 C, 13585 C, 9860 M, 15387 C) were on an erroneous D-350 account `ENR-LEG-23819F96FE`.

The existing `scripts/fix-legacy-receipts.mjs` was run with `--config=config/dpb350-receipt-correction-20261015.json`, first in a rolled-back dry run and then with `--apply` in production. It moved the four receipts to DPB-350 and recalculated chronological payment coverage to NOP 3–11, January–September 2026. The emptied D-350 account was removed after verifying it had no remaining payments, transfers, or sales. The target account status recalculated from `150D` to `U`.

All nine amounts remain PHP 350 each, totaling PHP 3,150. Receipt numbers, OR dates and remittance values were preserved. A pre-correction snapshot is in `backups/`; Audit Log and Record Corrections record the updates and empty-account removal.

Persistent overrides for all nine M3-COLL source rows in `config/legacy-migration-map.json` point explicitly to `DP-0010`, preventing confusion with D-350 and D-350 (5Y). Read-only verification uses `scripts/correct-d350-receipts.mjs --receipts=9242C,10941C,13585C,9860M,15387C,17105C,19617C,21670C,22139C --expected-program-id=DP-0010 --expected-total=3150 --verify-histories`.
