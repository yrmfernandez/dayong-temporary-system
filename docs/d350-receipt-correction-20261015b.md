# Nine receipts confirmed as D-350 (second set)

On October 15, 2026, the owner confirmed ORs 9300 C, 11444C, 13648 C, 14799 C, 15831 C, 18569C, 20369 C, 21065 C and 23790 C all belong to D-350 (`DP-0013`).

A read-only production check (`scripts/correct-d350-receipts.mjs --receipts=… --expected-program-id=DP-0013 --verify-histories`) found all nine under member `MEM-LEG-953E387C77`, ₱350 each:

- Eight on D-350 account `ENR-LEG-9A8B78660B`.
- OR 14799 C (April 16, 2026, `COL-LEG-0BCD550D99`) on a separate DPB-350 account `ENR-LEG-F7CC44C92C`, as NOP 43.

Because of the misfiled April receipt, the D-350 account skipped April: 15831 C (May 18) was numbered NOP 43 for April, and each later receipt covered the month before its own.

## Correction

`config/d350-receipt-correction-20261015b.json`, run with the existing `scripts/fix-legacy-receipts.mjs`:

1. Move 14799 C to the D-350 account and renumber its payments in OR-date order: 9300 C NOP 40 (January) through 23790 C NOP 48 (September).
2. Delete the DPB-350 account if it is then empty. The script refuses if any other payment or transfer remains, or its New Sale is on a remittance slip.

Status: **done** (October 15, 2026). The owner ran the dry run (renumbering NOP 40–48, status 90D → U, DPB-350 account empty: 0 New Sales, 0 beneficiaries), then `--apply` on production. The verification passed: nine receipts on D-350 account `ENR-LEG-9A8B78660B`, NOP 40–48 for January–September 2026, ₱3,150, status U; the member has no other account. Commands used:

```
npm run prod -- node scripts/fix-legacy-receipts.mjs --config=config/d350-receipt-correction-20261015b.json
npm run prod -- node scripts/fix-legacy-receipts.mjs --config=config/d350-receipt-correction-20261015b.json --apply
```

Verify afterwards (read-only; total ₱3,150):

```
npm run prod -- node scripts/correct-d350-receipts.mjs --receipts=9300C,11444C,13648C,14799C,15831C,18569C,20369C,21065C,23790C --expected-program-id=DP-0013 --expected-total=3150 --verify-histories
```
