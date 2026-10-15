# CINDE CALUMBAY MAS assignment

On October 15, 2026, the owner identified the legacy MAS label `Calumbay, C.` as **CINDE CALUMBAY** and requested her seven members in the database.

Production already contained seven distinct members, seven program accounts, and seven sales with that abbreviated MAS label. No matching employee existed and the accounts had no MAS employee link.

`scripts/link-cinde-calumbay.mjs` was run as a dry run, then applied in one production transaction. It registered CINDE CALUMBAY as active MAS `LEG-2026-0002`, assigned Butuan (primary) and Cabadbaran, and corrected the MAS name and employee link on all seven accounts and seven sales. It created no duplicate members or sales and made no payment changes. A backup was saved in `backups/`; updates are audited and a summary is in Record Corrections.

`config/legacy-migration-map.json` maps the old abbreviation to that employee ID for future imports. The script defaults to read-only and verifies seven distinct existing members before applying.

Follow-up verification used the existing `scripts/migrate-legacy-members.mjs` against the local old-data workbook and production, with `--source-title=Data-Base-Old --repair --fix-nop-typos` and without `--apply`. It reported zero additional members, accounts, New Sales, or collections to write. The legacy report identifies several Butuan NOP 1 collections as repeats of the New Sale, which are intentionally skipped. Unrelated invalid or held-back accounts in other territories were left unchanged. The row-reference-only report is `backups/legacy-migration-report-2026-10-15T02-18-09-902Z.txt`.

A subsequent read-only run of `scripts/link-cinde-calumbay.mjs` verified the same employee ID and seven existing members/accounts, assigned to Butuan and Cabadbaran. No further database writes were needed.
