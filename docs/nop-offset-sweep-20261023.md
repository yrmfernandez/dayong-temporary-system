# Source-confirmed NOP offset sweep — October 23, 2026

Following the PH-13437031 correction, the owner requested finding and fixing similar issues. The scan examined 14,321 accounts and 65,252 collection records, looking for non-registration, fixed-payment accounts whose collection NOPs were one below the sequence implied by their saved covered months and DOI.

Original workbook receipt identity, date, amount, program and NOP ranges confirmed 55 complete account histories, covering 234 collection corrections. Both staging and production rollback previews ran before production application. The repair refreshes account statuses and recalculates existing unlinked financial snapshots where necessary. It preserves covered months, DOI, gross payments, receipt identity, actual cash and empty imported financial fields. Six existing financial breakdowns change; the aggregate company share changes by zero. No remittance slips change.

Seventy other candidates remain for review: 39 have receipts that cannot be fully matched to the source, 10 have prior corrections or explicit coverage exceptions, and 21 have only one receipt without the corroboration required by this sweep. These are candidates, not confirmed errors. Individual histories, review lists, plans and backups remain in ignored private files.

- Audit: `scripts/audit-nop-offset-20261023.mjs` (read-only; `--cached` reuses its private source index; `--out=<file>` selects the private plan).
- Repair: `scripts/repair-nop-offset-20261023.mjs` (`--plan=<file>`, preview by default, `--apply` commits).
- Readback: the repair's `--verify=<applied-backup>` compares every saved receipt and account against its reviewed snapshot, checks financial recalculations, and verifies Audit Log and Record Corrections coverage.

The production plan is `legacy-data/nop-offset-plan-20261023-private.json`. Prior corrections and owner exceptions are protected; ambiguous source histories are never renumbered automatically.
