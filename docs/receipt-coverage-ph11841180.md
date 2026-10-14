# PH-11841180 payment coverage correction

Owner confirmed October 14, 2026: receipt 10310 C covers January 2026, and receipt 21532 C is one payment of 630 on August 2, 2026 covering June, July and August. Coverage follows the supplied receipt order.

| Receipt | Coverage in 2026 | NOP |
| --- | --- | --- |
| 10310 C | January | 20 |
| 13312 C | February | 21 |
| 14133 C | March | 22 |
| 9947 M | April | 23 |
| 16663C | May | 24 |
| 21532 C | June–August | 25–27 |
| 24358 C | September | 28 |
| 26171C (later production receipt) | October | 29 |

Applied to staging (seven receipts) and production (eight receipts), with Audit Log and Record Corrections entries. The later production receipt 26171C, dated October 11, follows the corrected sequence into October. Dates, amounts, ownership and duplicate labels are preserved. Another member's 21532 C entry is untouched.

The owner subsequently confirmed that PH-03674816's receipt is **21533 C**. `scripts/fix-21532-21533-receipts.mjs` corrected that number and removed the duplicate label and `legacy_duplicate` flag from PH-11841180's **21532 C** on staging and production. Both remain single 630 payments dated August 2, 2026 covering June–August. Conflict checks and post-update verification passed; both changes have Audit Log and Record Corrections entries. This script defaults to a transaction that rolls back; `--apply` commits, and reruns verify without rewriting corrected entries.

`scripts/fix-ph11841180-coverage.mjs` validates the account, DOI, receipt set, dates, amounts and resulting payment allocations in one transaction. It recalculates account status; default runs roll back, `--apply` commits, and reruns leave already corrected records alone.

```sh
node scripts/fix-ph11841180-coverage.mjs
node scripts/fix-ph11841180-coverage.mjs --apply
npm run prod -- node scripts/fix-ph11841180-coverage.mjs
npm run prod -- node scripts/fix-ph11841180-coverage.mjs --apply
```
