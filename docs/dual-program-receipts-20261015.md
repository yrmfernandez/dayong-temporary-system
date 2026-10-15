# D-210 HG and D-300 (Bracketing) receipt verification

On October 15, 2026, the owner confirmed that the member identified by the ten listed receipts has two programs: D-210 HG and D-300 (Bracketing).

Production already has one member (`MEM-LEG-DC9E2D03B9`) with the two correct program accounts. All ten listed receipts are assigned correctly, with five on each account:

| Program | Account | Listed receipts |
| --- | --- | --- |
| D-210 HG (`DP-0005`) | `ENR-LEG-CEDFB653CE` | 3788 B, 6459 B, 10377B, 12676 B, 14598 B |
| D-300 (Bracketing) (`DP-0067`) | `ENR-LEG-FE27352FEE` | 3789 B, 6460 B, 10378B, 11578 B, 12675 B |

Each account has eight posted collections in total. Read-only validation through `accountState` passed for the full payment history of both accounts; the last covered month is August 2026 for both. No member merge, receipt move, payment renumbering, or production write was needed. The calculated status on the verification date was `U`; the stored historical status was `90D` and was left unchanged.

The existing `scripts/legacy-sources.mjs` loader located the ten original M1-COLL rows without printing member details. Persistent per-row program overrides were added to `config/legacy-migration-map.json` to retain the confirmed split during future imports. A snapshot of the two accounts and their payment rows is in `backups/`.

`scripts/correct-d350-receipts.mjs` now also accepts `--receipts=` for read-only inspection of a supplied receipt list and `--verify-histories` to validate complete account histories using the application's rules. Its original `--verify` remains specific to the six D-350 receipts.
