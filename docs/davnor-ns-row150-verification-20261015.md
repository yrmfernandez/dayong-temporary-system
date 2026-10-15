# DAVNOR-NS timestamp verification

On October 15, 2026, the owner requested importing the DAVNOR-NS entry timestamped October 10, 2026 at 13:28:04. The existing source loader found one matching row, `Data-Base-Old|DAVNOR-NS|150`, for DSP-290 in Tagum under `Pañares, N.`. The Excel timestamp is stored with fractional-second precision just below the displayed second; the read-only timestamp lookup uses a one-second tolerance.

The existing importer was run as a production dry run using `--source-title=Data-Base-Old --only-ref="Data-Base-Old|DAVNOR-NS|150" --repair --fix-nop-typos`. It reported zero new members, accounts, sales or collections. No production writes were needed.

Verification by the deterministic source sale ID found:

- Member number `PH-08486118`, member ID `MEM-LEG-8EEB5E726A`, Active.
- DSP-290 account `ENR-LEG-18EF249A91`, Active, DOI October 10, 2026, Tagum.
- MAS `PAÑARES, NIMFA` (`DNDO-2026-0003`).
- New Sale `SALE-LEG-8EEB5E726A` already present.

`scripts/member-accounts.mjs --timestamp="10/10/2026 13:28:04" --sheet=DAVNOR-NS` now checks existing source sale/member/account links after locating a New Sales source row. It prints record IDs and account metadata without member personal details. The dry-run row-reference report is `backups/legacy-migration-report-2026-10-15T06-28-36-859Z.txt`.
