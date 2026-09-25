# Database migration readiness

Google Sheets is the current operational database. Every application-managed tab is treated as one flat table and is described in `config/sheet-database-schema.json`.

## Rules enforced now

1. Every data row has a stable primary key. The audit rejects missing and duplicate keys; `User Roles` uses the composite key `user_id + role_id`.
2. Columns have canonical data types. IDs and contact numbers remain text so leading zeroes are preserved. Amounts are numbers, dates use `YYYY-MM-DD`, timestamps use ISO-8601, and structured calculation snapshots use valid JSON.
3. Every existing display header has a deterministic lowercase `snake_case` database name. The mapping is emitted by the audit. The live display headers remain temporarily supported because current save paths validate them; changing the live headers is a separate compatibility migration.
4. Merged cells are rejected in application-managed tabs.
5. Blank rows inside a data range are rejected because they can indicate multiple tables or a broken export. Each entity has its own tab.

Run the read-only audit with:

```powershell
npm run sheets:audit
npm run sheets:audit -- --json
```

The JSON mode includes the exact future table and column names. Resolve every error before exporting data. Type warnings identify old cells that need normalization; they do not change live values.

## Safe header migration

Do not manually rename row 1 while the current application is running. Several server checks intentionally verify the present display headers to prevent writing into shifted columns. The safe sequence is:

1. Keep the canonical names in the schema registry as the source of truth.
2. Replace remaining positional/header checks with the shared schema adapter.
3. Deploy code that accepts both display headers and canonical headers.
4. Rename the live headers to canonical names in one audited migration.
5. Remove display-header compatibility after verification.

This staged change prevents a header rename from stopping Collections, MAM, Employees, Members, or encoder tracking.

## Future SQL migration

Export one CSV per registered tab. Create PostgreSQL tables from the canonical table names and column mappings, import parent tables before child tables, then add foreign keys and indexes after the data passes the audit. Application code should continue to call a data-access layer so the Google Sheets implementation can later be replaced without rewriting page components.
