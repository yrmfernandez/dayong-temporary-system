# Receipt 12665 B review — October 21, 2026

The owner reported receipt 12665 B missing and confirmed PH-77690372 as its member. Production receipt lookup found no matching Collection or New Sale and no matching deletion in the receipt-number search.

The normalized source index also returned no match. A full original-workbook scan found one exact receipt match in the 2026 collection source. Its cached source-index receipt number differs from the original workbook, so a cached lookup alone cannot establish absence.

The initial import preparation matched one member profile and one account, but source coverage overlapped an existing payment and its remittance date failed validation. The owner then supplied the nine-receipt history, confirming the missing receipt's August 20, 2026 OR date, PHP 350 amount and July/NOP 22 coverage. The supplied `8/20/0226` remittance date was normalized to August 20, 2026, matching the OR date and surrounding history.

The correction adds 12665 B, moves 14589 B to August/NOP 23, and moves a newer remitted payment to September/NOP 24 as explicitly confirmed by the owner. That newer payment was added during the investigation; the refreshed repair plan includes it. The complete saved history now has ten receipts. Three affected financial snapshots were recalculated, and account status was refreshed. Existing receipt identities, amounts, OR dates, DOI and member/program links were preserved. Linked remittance rows, parent remittances and recorded cash were verified unchanged.

The original workbook row's deterministic import ID was already occupied by a different receipt on a different account. The restoration uses a distinct deterministic ID derived from the source reference, confirmed member and receipt number, preserving the occupied row. Full records and comparisons remain private.

Validation: syntax checks passed; the complete transaction preview passed and rolled back; production application committed; separate readback verified receipt fields, unchanged unrelated fields, correction history and audit entries. A separate script matched every receipt's OR date, amount and coverage against all ten expected entries. Private before/applied snapshots were saved.

`scripts/scan-receipt-workbooks-private.mjs <receipt>` searches original workbook cells and saves matching rows in ignored private files. `--exports` searches the legacy CSV exports instead. Output is limited to counts; it does not print matching records. Both original workbooks and 19 exported/review source files were checked for this request.

`scripts/prepare-owner-12665b-private.mjs` prepares this owner-confirmed history with guards against changed records. `scripts/import-receipt-private.mjs --owner-history` applies reviewed existing coverage corrections and the missing receipt atomically, preserving remittance amounts. `scripts/check-12665b-link-private.mjs` independently compares saved records using aggregate output.
