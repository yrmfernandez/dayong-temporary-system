# Bracketing source audit and repairs — October 21, 2026

The owner requested finding and fixing cases similar to the PH-02795415 and PH-46732266 Bracketing corrections.

Scanned 1,462 Bracketing accounts and 8,134 receipts against 62,424 indexed original collection rows and 3,071 New Sales. Applied 282 source-supported account corrections: 75 receipt NOP corrections across 31 accounts, 29 DOI-day corrections confirmed by their New Sales, and status-only refreshes on 251 other accounts. Account statuses changed on 264 of the 282 accounts.

The 75 corrected receipts already had the right covered months: this sweep corrected their NOPs. Amounts, receipt dates/labels, covered months, member/program/account links, branch and MAS were preserved. Recalculated 75 financial snapshots; no remittance expectations changed. DOI corrections were confined to the same enrollment month and confirmed by both saved and original New Sale dates.

Production rollback preview passed, then the apply transaction committed. Independent readback verified all 282 account/correction records, 75 corrected receipts and financial snapshots, and 355 distinct changed records in Audit Log. A fresh source audit found zero remaining candidates meeting the same evidence requirements.

Backup: `backups/bracketing-source-applied-20261021-1792555853111.json`. It contains the exact reviewed plan, before snapshots, financial calculations and correction IDs. Every account has its own Record Corrections entry under Bracketing source history correction.

## Histories corrected

| Member | Receipt NOP corrections | DOI before | DOI after | Status before | Status after |
| --- | ---: | --- | --- | --- | --- |
| PH-02854451 | 3 | 2026-03-01 | 2026-03-17 | 150D | 90D |
| PH-06425247 | 1 | 2026-01-01 | 2026-01-24 | Forfeited | Forfeited |
| PH-09040384 | 2 | 2026-03-01 | 2026-03-23 | 150D | 120D |
| PH-09522743 | 1 | 2026-01-01 | 2026-01-07 | Forfeited | Forfeited |
| PH-15340786 | 3 | 2026-04-01 | 2026-04-07 | 120D | 90D |
| PH-17860143 | 1 | 2026-04-01 | 2026-04-21 | 150D | 120D |
| PH-22678799 | 1 | 2026-03-01 | 2026-03-13 | 150D | 150D |
| PH-30978468 | 5 | 2026-03-01 | 2026-03-09 | 90D | U |
| PH-31427919 | 2 | 2026-04-01 | 2026-04-16 | 150D | 120D |
| PH-31607228 | 1 | 2026-04-01 | 2026-04-16 | 150D | 150D |
| PH-31892931 | 2 | 2026-03-01 | 2026-03-30 | 150D | 150D |
| PH-34623689 | 1 | 2026-04-01 | 2026-04-06 | 150D | 150D |
| PH-39631550 | 3 | 2026-04-01 | 2026-04-29 | 120D | 60D |
| PH-40625078 | 1 | 2026-01-01 | 2026-01-07 | Forfeited | Forfeited |
| PH-45008156 | 3 | 2025-11-01 | 2025-11-01 | Forfeited | Forfeited |
| PH-49129758 | 5 | 2026-04-01 | 2026-04-15 | 60D | U |
| PH-50864131 | 1 | 2026-04-01 | 2026-04-13 | 150D | 150D |
| PH-51111864 | 1 | 2026-01-01 | 2026-01-25 | Forfeited | Forfeited |
| PH-58885187 | 6 | 2026-02-01 | 2026-02-23 | 90D | U |
| PH-60187968 | 6 | 2026-03-01 | 2026-03-09 | 60D | U |
| PH-63689409 | 1 | 2026-04-01 | 2026-04-14 | 150D | 150D |
| PH-71954738 | 1 | 2026-01-01 | 2026-01-21 | Forfeited | Forfeited |
| PH-77409350 | 2 | 2026-01-01 | 2026-01-02 | Forfeited | Forfeited |
| PH-77785640 | 2 | 2026-01-01 | 2026-01-02 | Forfeited | Forfeited |
| PH-84102133 | 2 | 2026-04-01 | 2026-04-16 | 150D | 120D |
| PH-87477516 | 1 | 2026-04-01 | 2026-04-06 | 150D | 150D |
| PH-87590744 | 5 | 2026-03-01 | 2026-03-27 | 90D | U |
| PH-88128185 | 2 | 2026-03-01 | 2026-03-30 | 150D | 150D |
| PH-90748266 | 5 | 2026-04-01 | 2026-04-23 | 60D | U |
| PH-92752991 | 3 | 2025-12-01 | 2025-12-01 | Forfeited | Forfeited |
| PH-92754393 | 2 | 2026-01-01 | 2026-01-24 | Forfeited | Forfeited |

## Cases left for review

837 histories did not pass complete source confirmation: 663 had an unconfirmed receipt, 111 conflicting source sequences, 61 an unconfirmed New Sale, and two conflicting enrollment months. Of these, 338 show apparent source differences; those differences are leads, not approved correction instructions. The remaining accounts were already correct, previously reviewed, or had no collections.

Incomplete, conflicting, multi-month or unmatched source records were left unchanged. No members or accounts were merged or deleted by this sweep. See the [review list](bracketing-source-review-20261021.md) for the 338 histories with apparent differences.

## Commands

- Audit: `node scripts/prod.mjs node scripts/audit-bracketing-source.mjs` (use `--cached` to reuse the private local source index).
- Preview: `node scripts/prod.mjs node scripts/repair-bracketing-source.mjs`.
- Apply: add `--apply` after reviewing the generated plan.
- Verify: `node scripts/prod.mjs node scripts/repair-bracketing-source.mjs --verify`.

The repair checks every reviewed account and receipt against the audit snapshot before writing, backs up affected records, applies only the reviewed NOP/month/DOI/status changes, reprices changed NOPs, verifies all unaffected fields, and verifies Audit Log/Record Corrections before commit. The post-repair audit plan has no applicable cases, so another apply stops without writing.
