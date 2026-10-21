# Receipt 03407 S import review — October 21, 2026

The owner requested adding receipt 03407 S. Scripts searched the production database and original 2026 workbook using receipt normalization that includes leading-zero variants.

Aggregate checks confirm one original collection source row, no existing collection or New Sale, and no matching deletion history. The source has a readable date, positive amount and parseable month/NOP coverage.

The scripts could not confirm an existing member profile or a member/account matching the source person, program and branch. Tracing all original rows with the same normalized source name found only this receipt, with no related imported record establishing a member link. No insert was attempted. The owner was asked for the correct PH member number before attaching the receipt or creating any account.

## Imported after owner confirmation

The owner confirmed **PH-74827073**. Script validation found exactly one account matching that member, source program and branch. The source covered month fits without overlap, but its NOP does not agree with the confirmed account DOI. The script derived the NOP from that DOI only after checking that the complete existing history plus the proposed receipt form a continuous, valid month/NOP sequence. Source receipt label, amount, OR date and covered month were retained.

`import-receipt-private.mjs 03407S` passed a rollback preview, then committed with `--apply`. The script imported one historical Posted/Remitted collection, calculated its financial snapshot, refreshed the account status, recorded the owner confirmation and original/derived coverage in Record Corrections, and added an insertion Audit Log entry. It did not create a new turnover or modify any existing receipt. A separate `--verify` readback confirmed the exact saved receipt, unique receipt occurrence, unchanged prior history, resulting status, correction and audit entry.

An initial attempt to obtain broad table locks timed out before inserting. The import now uses a receipt-specific advisory lock, serializable isolation, an account row lock, locked history rows and snapshot/duplicate guards. The narrower transaction passed another rollback preview and applied successfully.

Private committed snapshot: `backups/receipt-03407S-applied-private.json`. Source/candidate records and diagnostics remain private; command output contains counts and verification flags only.

Private source and candidate details are stored in ignored `legacy-data/receipt-03407S-location-private.json` and `legacy-data/receipt-03407S-import-plan-private.json`. Tool output contains aggregate checks only.

Scripts: `locate-receipt-private.mjs 03407S` checks duplicates, source matches and deletion history. `prepare-receipt-import-private.mjs 03407S` checks the original row and resolves members/accounts; `--cached` reuses the privately saved row and `--trace-source` repeats the original-row trace. Run through `node scripts/prod.mjs node scripts/<script>` for production.

After the owner confirmation, prepare with `--cached --member=PH-74827073`. Import with `node scripts/prod.mjs node scripts/import-receipt-private.mjs 03407S --apply`; verify with the same command replacing `--apply` with `--verify`. A repeat import is refused by duplicate checks.
