# Split-program candidate audit

`scripts/find-split-program-candidates.mjs` searches a read-only repeatable-read snapshot for members with posted collections on at least two related program accounts: DPB-420/D-420, D-460 (59B)/D-460, DPB-350/D-350/D-350 (5Y), and D-300/D-300 (Bracketing). It exports complete candidate details and priority receipt tables to ignored `legacy-data/unresolved-split-programs-2026-10-14-<project>.json` and `.md`. No database data is changed.

Strong pattern: the accounts share DOI and rate, each receipt pays one exact installment, receipts occupy consecutive calendar months with one receipt per month, and the series switches between accounts at least twice. Continuous pattern: same DOI/rate, consecutive NOP ranges without stored-month overlap. Remaining candidates require source review. These classifications are clues, not proof of a single enrollment; some related programs have intentionally different incentives, and program transitions can be legitimate. Do not automatically merge the results.

The October 14, 2026 production scan found 253 candidate member/family combinations: 46 strong patterns, 67 continuous sequences across accounts, and 140 requiring closer source review. Program-family totals: D-460 (59B)/D-460 19; DPB-420/D-420 40; the 350 family 191; the 300 family 3. Previously corrected members PH-69288046, PH-44391390, PH-46144403, PH-60638126 and PH-78528286 were not flagged.

```sh
npm run prod -- node scripts/find-split-program-candidates.mjs
```
