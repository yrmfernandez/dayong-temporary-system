# Seven-member review and date corrections — October 23, 2026

The owner requested fixes for the seven members below. Their current payment histories independently pass the account rules, including NOP and month spans. Prior program moves and merges are preserved; a source difference alone does not justify reversing them. Matching original workbook receipt identities, OR dates and amounts confirm 49 missing Date Remitted values, all on or after their receipt dates.

| Member | Restored remittance dates |
| --- | ---: |
| PH-67351553 | 6 |
| PH-46825655 | 9 |
| PH-02029542 | 9 |
| PH-91569049 | 6 |
| PH-47993881 | 5 |
| PH-06901860 | 9 |
| PH-68238498 | 5 |
| Total | 49 |

`scripts/fix-seven-member-dates-20261023.mjs` ran staging and production rollback previews before committing the production changes. The script verifies every saved receipt against the private before snapshot, permitting only the specified missing remittance dates to change. Amounts, NOPs, covered months, DOI, account statuses, financial snapshots, profiles and New Sales remain unchanged. PH-02029542's additional system-entered payment already has its remittance date and remains untouched.

Each member has a Record Corrections summary and every corrected receipt has an Audit Log entry. Source cells, comparisons, plans and backups stay in ignored private files. Production readback: `node scripts/prod.mjs node scripts/fix-seven-member-dates-20261023.mjs --verify`.
