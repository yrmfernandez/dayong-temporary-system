# Database migration readiness

Google Sheets is the current operational database. Every application-managed tab is treated as one flat table and is described in `config/sheet-database-schema.json`.

## Rules enforced now

1. Every data row has a stable primary key. The audit rejects missing and duplicate keys; `User Roles` uses the composite key `user_id + role_id`.
2. Columns have canonical data types. IDs and contact numbers remain text so leading zeroes are preserved. Amounts are numbers, dates use `YYYY-MM-DD`, timestamps use ISO-8601, and structured calculation snapshots use valid JSON.
3. Every application-managed sheet now uses lowercase `snake_case` headers in row 1. Runtime compatibility checks normalize header names so a partially migrated environment fails safely instead of writing into shifted columns.
4. Merged cells are rejected in application-managed tabs.
5. Blank rows inside a data range are rejected because they can indicate multiple tables or a broken export. Each entity has its own tab.

Run the read-only audit with:

```powershell
npm run sheets:audit
npm run sheets:audit -- --json
```

The JSON mode includes the exact future table and column names. Resolve every error before exporting data. Type warnings identify old cells that need normalization; they do not change live values.

## Header migration

The live spreadsheet was migrated with:

```powershell
npm run sheets:headers
npm run sheets:headers -- --apply
```

The command checks for blanks, invalid names, and collisions before changing row 1. It is safe to rerun and does not modify data rows, validation, notes, or formatting. Do not manually rename columns without running the audit afterward.

## Future SQL migration

Export one CSV per registered tab. Create PostgreSQL tables from the canonical table names and column mappings, import parent tables before child tables, then add foreign keys and indexes after the data passes the audit. Application code should continue to call a data-access layer so the Google Sheets implementation can later be replaced without rewriting page components.
