# CINDE CALUMBAY MAS assignment

On October 15, 2026, the owner identified the legacy MAS label `Calumbay, C.` as **CINDE CALUMBAY** and requested her seven members in the database.

Production already contained seven distinct members, seven program accounts, and seven sales with that abbreviated MAS label. No matching employee existed and the accounts had no MAS employee link.

`scripts/link-cinde-calumbay.mjs` was run as a dry run, then applied in one production transaction. It registered CINDE CALUMBAY as active MAS `LEG-2026-0002`, assigned Butuan (primary) and Cabadbaran, and corrected the MAS name and employee link on all seven accounts and seven sales. It created no duplicate members or sales and made no payment changes. A backup was saved in `backups/`; updates are audited and a summary is in Record Corrections.

`config/legacy-migration-map.json` maps the old abbreviation to that employee ID for future imports. The script defaults to read-only and verifies seven distinct existing members before applying.

Follow-up verification used the existing `scripts/migrate-legacy-members.mjs` against the local old-data workbook and production, with `--source-title=Data-Base-Old --repair --fix-nop-typos` and without `--apply`. It reported zero additional members, accounts, New Sales, or collections to write. The legacy report identifies several Butuan NOP 1 collections as repeats of the New Sale, which are intentionally skipped. Unrelated invalid or held-back accounts in other territories were left unchanged. The row-reference-only report is `backups/legacy-migration-report-2026-10-15T02-18-09-902Z.txt`.

A subsequent read-only run of `scripts/link-cinde-calumbay.mjs` verified the same employee ID and seven existing members/accounts, assigned to Butuan and Cabadbaran. No further database writes were needed.

## September 4 timestamp assignment

The owner subsequently requested the legacy entry timestamped September 4, 2026 at 11:08:57 under CINDE CALUMBAY. The existing source loader found exactly one row, `Data-Base-Old|BUTUAN-NS|86`, for DSP-290 in Butuan under `Calumbay, C.`.

The member already existed as `PH-25732586` (`MEM-LEG-13CC32C9C9`), with active account `ENR-LEG-BE66BD801D`, DOI September 4, 2026. Its current MAS was RACHO, KRISTINE (`LEG-2026-0022`). `scripts/assign-source86-to-cinde.mjs` was tested in a rolled-back production dry run, then applied in one transaction. It assigned only this current enrollment to CINDE CALUMBAY (`LEG-2026-0002`), retained Butuan, and recorded the change in Member Transfers, Audit Log and Record Corrections.

Consistent with the application's member-transfer behavior, the existing one New Sale and one collection retained their historical MAS and financial data. Counts, collection total and sale details were checked before and after the update. A pre-change snapshot is in `backups/`.

Post-commit verification using `scripts/member-accounts.mjs PH-25732586` confirmed the member and DSP-290 account are Active and the account is eligible for CINDE CALUMBAY's Butuan Collections batch. No duplicate member or enrollment was created.

The owner also requested the next entry at September 4, 2026 11:11:14. Exact timestamp lookup found `Data-Base-Old|BUTUAN-NS|87`, member `PH-51014544` (`MEM-LEG-378041CD7A`), active DSP-290 account `ENR-LEG-121ECD2643`, DOI September 4, 2026, Butuan. The existing script now accepts `--source-row=87` for this reviewed account, retaining row 86 as its default and rejecting unreviewed source rows.

After a rolled-back production dry run, `scripts/assign-source86-to-cinde.mjs --source-row=87 --apply` transferred only this enrollment from RACHO, KRISTINE to CINDE CALUMBAY. Member Transfers, Audit Log and Record Corrections record the assignment, and a pre-change backup is in `backups/`. Its one historical New Sale and one collection retained their original MAS and financial data. Post-commit `scripts/member-accounts.mjs PH-51014544` verified an Active account eligible for CINDE CALUMBAY's Butuan Collections batch.
