# CONDES, MILDRED legacy verification

On October 15, 2026, the owner identified `Condes, M.` in the old sheet as **CONDES, MILDRED** and requested registration with the associated members.

Production already contains the requested employee as `SDS-2026-0007`. A read-only check verified 22 distinct members with 22 program accounts, 19 sales, three collections, and one remittance under the canonical MAS name and employee link. The accounts are in Cabadbaran. No duplicate employee or member was created, and no production changes were needed.

Using the existing `scripts/legacy-sources.mjs` loader, `scripts/link-legacy-mas.mjs --alias="Condes, M." --name="CONDES, MILDRED" --inspect-source` found 18 New Sales and 11 Collections rows in the local old-data workbook. All 18 sales and three collection source IDs are already in production. The existing importer report `backups/legacy-migration-report-2026-10-15T02-18-09-902Z.txt` identifies the other eight collection rows (BUTUAN-COLL 17, 18, 40, 41, 57, 58, 59, 63) as NOP 1 repeats of New Sales, intentionally skipped to prevent duplicate payments.

The alias `Condes, M.` is mapped to `SDS-2026-0007` in `config/legacy-migration-map.json` for future imports. Verification output contains staff details, counts, and source row references only, with no member personal details.

The reusable linking script defaults to read-only. Applying a future owner-confirmed MAS correction requires explicit reviewed member/account counts; updates run in a transaction with a backup, audit attribution, and a Record Corrections summary.

For an additional member request, `scripts/member-accounts.mjs` supports `--name="Surname,First Middle" --legacy`: it reports matching database IDs and legacy source references without printing member personal fields. An unmatched or ambiguous search stops without writing; a program enrollment or identifying receipt/application reference is needed before creating an account under this MAS.

`--scan-all-cells --mas=Condes` expands the read-only search to other worksheet fields and first-name variations under the specified MAS. It reports only source references, field names, staff labels and match flags, with no member field values. Header matching ignores spacing and punctuation.

`--sheet=BUTUAN-NS` limits workbook inspection to that tab and reports its row count and closest name-match row references with edit distances, without printing names. The first local workbook snapshot inspected on October 15 had 217 data rows on BUTUAN-NS and a filesystem modification date of October 10, 2026. The owner replaced it with a newer workbook, containing 222 BUTUAN-NS data rows, before the additional member import below.

## Additional member imported from the updated workbook

The owner supplied timestamp `10/12/2026 9:34:44` for the requested member. The updated workbook has one exact timestamp match at `Data-Base-Old|BUTUAN-NS|221`, and the name search confirmed the owner-supplied full name. Its enrollment is DSP-290 in Cabadbaran under `Condes, M.`.

On October 15, the existing importer was run with `--source-title=Data-Base-Old --only-ref="Data-Base-Old|BUTUAN-NS|221" --repair --fix-nop-typos`, first as a dry run and then with `--apply` on production. It added exactly one member, one account, and one New Sale; no beneficiaries, collections, or unrelated records were written. The importer now accepts `--only-ref` to scope writes while retaining full-workbook matching and validation. Local imports without repairs no longer perform an unused Google Sheets metadata request.

Verification found member `PH-12460274` (`MEM-LEG-40F9FC11C0`), account `ENR-LEG-0034FB417D`, and sale `SALE-LEG-40F9FC11C0`. The member and DSP-290 account are Active, DOI October 12, 2026, linked to `CONDES, MILDRED` (`SDS-2026-0007`) in Cabadbaran. The account is eligible to be listed in that MAS/branch Collections batch. Written IDs are backed up in `backups/legacy-migration-ids-2026-10-15T03-26-29-766Z.json`.
