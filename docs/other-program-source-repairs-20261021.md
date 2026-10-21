# Other-program source audit — October 21, 2026

The owner requested checking other programs for problems similar to the Bracketing corrections, using scripts so individual records are not exposed in the assistant output.

Scanned 12,806 accounts across 46 non-Bracketing programs and 56,525 receipts. Indexed 62,424 original collection rows and 3,071 New Sales. Only aggregate statistics were printed; source/member rows, plans, snapshots and review records remain under ignored private directories.

## Applied and verified

- Corrected 2 receipt-month histories on 2 accounts. Their original source months and NOPs form a continuous sequence consistent with the enrollment date.
- Refreshed stale account statuses on 973 additional accounts.
- Total affected accounts: 975; Record Corrections entries verified: 975; distinct changed records verified in Audit Log: 977.
- NOP corrections: 0; DOI changes: 0; financial snapshots changed: 0; remittance expectations changed: 0.
- Receipt amounts, dates, labels, member/account/program links, branch, MAS and all other unaffected fields were checked against the backup and preserved.

## Evidence and exclusions

Complete histories must match the original receipt ID, OR label/date, amount and source program. Source-covered months and NOP spans must match in length, be continuous and agree with the enrollment month and the current registration-fee numbering rule. Status calculation uses each program’s flexible-payment limits and six- or twelve-month forfeiture rule. A New Sale, when present, must independently match its original source before an enrollment-day correction can be proposed.

Previously corrected accounts and owner overrides are protected using Record Corrections and local correction configurations, including IDs nested in prior correction summaries. Linked/mapped remittance entries, incomplete or conflicting source rows, invalid histories and accounts without collections were excluded.

| Audit exclusion | Accounts |
| --- | ---: |
| noCollections | 2949 |
| unconfirmedSourceReceipt | 4084 |
| priorCorrectionOrOwnerOverride | 3782 |
| unconfirmedSourceNewSale | 341 |
| alreadyCorrect | 208 |
| sourceSequenceConflict | 467 |

Exclusions are not proof of erroneous data. Private review records are stored with the audit plan; individual members are not listed in this document.

## Validation and scripts

- Synthetic rule tests cover contiguous source spans, conflicting/gapped ranges, prior-year arrears, registration-fee numbering, program distinctions and invalid dates.
- Production preview made the proposed writes in a transaction, verified all unaffected fields and audit/correction coverage, then rolled back.
- Apply repeated the snapshot guards and field/audit verification before committing. An independent readback verified all saved results.

- Fresh audit after applying: 12,811 accounts, 56,533 receipts, 0 remaining candidates meeting these confirmation requirements. Counts can increase while staff continue encoding.

Applied backup: `backups/other-program-source-applied-20261021-1792556541046.json`. Contains the complete private before snapshot, reviewed plan and correction IDs.

Commands (aggregate-only output):

- Audit: `node scripts/prod.mjs node scripts/audit-other-program-source.mjs`; use `--cached` to reuse the local source index.
- Preview: `node scripts/prod.mjs node scripts/repair-other-program-source.mjs`.
- Apply: add `--apply` after verifying the preview.
- Independent verification: `node scripts/prod.mjs node scripts/repair-other-program-source.mjs --verify`.
- Tests: `node --test scripts/test-source-history-rules.mjs`.
- Regenerate this aggregate report: `node scripts/report-other-program-source.mjs`.

Database repair diagnostics are saved privately; failures print a generic message to prevent assertion differences or database error details from exposing records.
