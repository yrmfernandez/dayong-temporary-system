# Read-only database data audit

Run `node scripts/audit-database-data.mjs` for staging or `npm run prod -- node scripts/audit-database-data.mjs` for production. Optional `--as-of=YYYY-MM-DD` fixes the reporting date; otherwise it uses today's Manila date.

The script opens one repeatable-read, read-only transaction and checks every declared public-table foreign key, member/account ownership and copied numbers, sales/account relationships, duplicate numbers and possible duplicate members, receipt/application formatting, dates, payment coverage/NOP alignment, application account validation/status, current program amount rules, remittance source links/net amounts/totals, and basic finance arithmetic. Rejected/voided remittance mappings are retained history and excluded from active-source mismatch checks. Remittance mappings may reference either a collection or a New Sale.

Full findings are saved as JSON and a readable Markdown report in ignored `legacy-data/database-audit-<date>-<project>.*`. These contain record IDs, member numbers and operational values, without member names, addresses, contacts, credentials or receipt images. Do not commit reports containing real data.

Counts overlap and distinguish imported IDs from both prior sources (`-LEG-` and `-WEB-`). Review findings are candidates for investigation: matching names/birthdates do not establish identity, historical program rates may differ, and stored account statuses can be stale as time passes. Internally consistent but wrongly assigned receipts or covered months require comparison against paper records. The audit does not recompute payroll, incentives or bank reconciliation.

The October 14, 2026 production scan found current-entry problems including an enrollment/sale using year 12026 and three NOP/month offsets, alongside imported data review items. Declared foreign keys, member/account ownership links and active remittance reconciliation passed. No database records were changed by this audit.
