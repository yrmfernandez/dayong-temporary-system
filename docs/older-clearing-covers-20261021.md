# Older Clearing remitting selections corrected — October 21, 2026

The owner requested correcting clearings dated before today where the clerk selected both New Sales and Collections although only one kind was remitted.

`scripts/fix-older-clearing-covers.mjs` previews the Clearing page's 60-day window, assigns entries to their latest eligible clearing using the page's branch, person, date, encoding-time and kind rules, and narrows Both only when exactly one kind has encoded entries. Today's lines, Removed lines, lines containing both kinds and lines with no encoded entries are excluded. No sales, collections, amounts, receipt times or remittance decisions change.

Staging preview and apply found no candidates. Production preview found six; all six were applied and verified in one transaction with Audit Log records and Record Corrections summary `COR-CLR-MVHF8W9Q`.

| Clearing | Date | Corrected Remitting | Encoded entries | Approved |
| --- | --- | --- | ---: | ---: |
| CLR-20261013024416-C68X | 2026-10-13 | Collections | 1 | 1 |
| CLR-20261014023227-2SQS | 2026-10-14 | Collections | 1 | 1 |
| CLR-20261017041942-LEX0 | 2026-10-17 | New Sales | 1 | 1 |
| CLR-20261019052559-A8LE | 2026-10-19 | Collections | 2 | 2 |
| CLR-20261019053211-HCM4 | 2026-10-19 | Collections | 4 | 4 |
| CLR-20261020021357-1X37 | 2026-10-20 | New Sales | 1 | 0 |

The five fully approved lines now qualify to leave Clearing. The October 20 line stays until its actual New Sales entries are approved. The other 65 older Both lines contain both kinds, and there were no empty Both lines needing review.

Run a preview with `node scripts/fix-older-clearing-covers.mjs`; use `node scripts/prod.mjs node scripts/fix-older-clearing-covers.mjs` for production. Add `--apply` to write. Applying locks clearings, sales and collections against concurrent writes, checks each update, records a correction summary, and verifies saved covers and audit records before committing.
