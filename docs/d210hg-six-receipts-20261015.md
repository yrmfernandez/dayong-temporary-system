# Six receipts verified as D-210 HG

On October 15, 2026, the owner confirmed ORs 12168 N, 15392N, 17951N, 02683T, 05451 T, and 07610 T belong to D-210 HG (`DP-0005`).

Read-only production verification found all six posted receipts already on account `ENR-LEG-C18A6D3A68`, member `MEM-LEG-EF9AC84CED`, under the correct program. Five receipts are PHP 420 each and OR 02683T is PHP 210, totaling PHP 2,310. Full payment-history validation passed using the application's account rules. The existing account DOI is April 1, 2025, with recorded coverage NOP 1–11, April 2025–February 2026, and stored/calculated status `150D` on the verification date. No receipt moves, coverage changes, account changes or production writes were made.

The existing legacy source loader located the six receipts in DDO 1-COLL rows 76, 1326, 2545, 3637, 5609 and 7753. Persistent per-row D-210 HG overrides were added to `config/legacy-migration-map.json` to retain the owner-confirmed program assignment in future imports. A pre-verification account/payment snapshot is in `backups/`.

Verification command: `scripts/correct-d350-receipts.mjs --receipts=12168N,15392N,17951N,02683T,05451T,07610T --member-id=MEM-LEG-EF9AC84CED --expected-program-id=DP-0005 --expected-total=2310 --verify-histories`.

## Owner-confirmed coverage correction

After the program verification above, the owner supplied the correct periods/NOPs for these six receipts in the same order. The recorded DOI, April 1, 2025, makes NOP 6 September 2025. The owner's January–February entry `10,1` was interpreted as `10,11`, consistent with the two-month payment and the following March NOP 12; this interpretation was stated before applying.

| Receipt | Correct coverage | Correct NOP |
| --- | --- | --- |
| 12168 N | September–October 2025 | 6–7 |
| 15392N | November–December 2025 | 8–9 |
| 17951N | January–February 2026 | 10–11 |
| 02683T | March 2026 | 12 |
| 05451 T | April–May 2026 | 13–14 |
| 07610 T | June–July 2026 | 15–16 |

Applied on production with the existing `scripts/consolidate-member-receipts.mjs`, which now accepts `--config` to isolate one correction: `--config=config/d210hg-six-coverage-20261015.json`, first as a rolled-back dry run, then with `--apply`. All six coverage/NOP ranges were corrected and the stored account status recalculated from `150D` to `60D` on October 15. No receipts moved, and member, program, DOI, receipt dates, amounts, incentives and remittance values were preserved; the total remains PHP 2,310. Changes are audited and summarized in Record Corrections. The pre-correction snapshot is in `backups/`.
