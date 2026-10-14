# PH-70661323 receipt ledger restoration

Owner supplied the full four-receipt ledger on October 14, 2026. Applied to staging and production with `scripts/restore-ph70661323-4191s.mjs` after successful dry runs. The script validates member/account/program, existing history and conflicting numbers; executes in one transaction; defaults to rollback; commits only with `--apply`; and verifies the ledger before commit. A repeat production run reported zero changes.

| Receipt | OR date | Amount | Covered months | NOP | Date remitted |
| --- | --- | ---: | --- | --- | --- |
| 4105 S | 2026-02-06 | 1050 | December 2025–February 2026 | 39–41 | 2026-02-07 |
| 779 S | 2026-04-24 | 700 | March–April 2026 | 42–43 | 2026-04-27 |
| 2299 S | 2026-07-15 | 1050 | May–July 2026 | 44–46 | 2026-07-16 |
| 4191 S | 2026-10-12 | 700 | August–September 2026 | 47–48 | 2026-10-12 |

The first three amounts, receipt dates and coverage already matched. Their Date Remitted values were updated to the owner-supplied dates. The missing fourth payment was added as COL-LEG-OWNER-70661323-4191S to the existing D-350 account ENR-LEG-97D0960851. Historical remittance status is Remitted, following legacy receipt restoration conventions, with no invented incentive/remittance breakdown and no approval slip created. The actor and actual restoration time identify its provenance.

PH-41570505's separate D-180 receipt remains PHP 180 dated February 3, 2026, covering January. It is now labelled **4191 S (duplicated)** with its duplicate flag set; the two records represent different payments sharing an OR number. Its financial values and ownership were preserved.

The restored account status recalculated to U. Changes have Audit Log entries and a Record Corrections summary containing the before/after ledger, account status and duplicate label. Creation is recorded in the correction summary because ordinary database inserts do not trigger update/delete audit events.

```sh
npm run prod -- node scripts/restore-ph70661323-4191s.mjs
npm run prod -- node scripts/restore-ph70661323-4191s.mjs --apply
```
