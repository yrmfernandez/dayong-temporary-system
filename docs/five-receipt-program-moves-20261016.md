# Five owner-confirmed receipt moves

On October 16, 2026, the owner confirmed the following receipt programs. Each source account contained only the listed receipt, with no New Sale or transfer. Pre-change backups were saved using `scripts/member-accounts.mjs --show-payments --backup`. The existing consolidation script was run through `scripts/prod.mjs` with `--config=config/five-receipt-program-moves-20261016.json`, first as a rolled-back dry run, then with `--apply`.

| Receipt | Member | Amount | Correct program | Coverage after correction | NOP |
| --- | --- | ---: | --- | --- | --- |
| 4382 S | PH-13660905 | PHP 920 | D-230 (`DP-0063`) | January–April 2026 | 52–55 |
| 12008 B | PH-38098964 | PHP 320 | D-320 (`DP-0011`) | May 2026 | 21 |
| 15945 B | PH-57731835 | PHP 280 | D-280 (`DP-0066`) | September 2026 | 37 |
| 10926B | PH-71477809 | PHP 550 | DFP-550 (`DP-0020`) | July 2026 | 47 |
| 08035T | PH-77790640 | PHP 190 | D-190 (`DP-0062`) | September 2026 | 67 |

The five receipts total PHP 2,260, unchanged. Destination accounts retain their existing DOIs. All 36 posted entries across the five destination accounts are renumbered chronologically and recalculated using the corrected program/NOPs and incentive rules. No linked remittance expectation needed adjustment. The five empty source accounts are removed; PH-57731835's separate DPB-420 account stays. Record Corrections and Audit Log retain the changes.

Post-commit verification checks each requested receipt's program and original amount, and validates the complete destination payment histories. D-320 is calculated `60D` (coverage through July 2026); the other four destination accounts are `U` on October 16, 2026.
