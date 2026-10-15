# ORs 13646 C and 14797 C corrected to D-350

On October 15, 2026, the owner confirmed that both receipts belong to D-350 (`DP-0013`). They belong to member `MEM-LEG-B949AC5C08`.

OR 13646 C (`COL-LEG-569063DFF3`, PHP 1,750, March 16, 2026) was already on D-350 account `ENR-LEG-74925547D2`, covering NOP 38–42, November 2025–March 2026. OR 14797 C (`COL-LEG-8CC73D73FE`, PHP 350, April 16, 2026) was on erroneous DPB-350 account `ENR-LEG-B0386CD720`.

The existing `scripts/fix-legacy-receipts.mjs` ran with `--config=config/d350-two-receipts-20261015.json`, first as a rolled-back dry run and then with `--apply` in production. It moved OR 14797 C to D-350, credited NOP 43 for April 2026, and recalculated the account status from `Forfeited` to `150D` on the verification date. The empty DPB-350 account was removed after checking it had no remaining payments, transfers or sales.

The two receipts still total PHP 2,100; amounts, dates and remittance values were preserved. A pre-correction snapshot is in `backups/`; Audit Log and Record Corrections retain the changes. Both M3-COLL source rows (4471 and 6339) now have persistent D-350 overrides in `config/legacy-migration-map.json`.

Read-only verification: `scripts/correct-d350-receipts.mjs --receipts=13646C,14797C --member-id=MEM-LEG-B949AC5C08 --expected-program-id=DP-0013 --expected-total=2100 --verify-histories`.
