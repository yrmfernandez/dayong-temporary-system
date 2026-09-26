# Encoder tracking review

Reviewed the application save paths and the connected Google spreadsheet's live header rows on 2026-09-25. Encoder tracking has now been implemented, and the fields below have been added to the live spreadsheet. The live row-1 labels were subsequently migrated to lowercase `snake_case` database names; descriptive names in this document identify the same columns. Historical data rows were not changed.

## Findings before implementation

- Google Sheets is the persistence layer used by the inspected save paths; no separate database client is configured in package.json.
- New sales create rows in Members (only for new members), Member programs, and Sales.
- Collections create a Remittances row and associated Collections rows.
- MAS identifies the assigned marketing staff, not necessarily the person entering the transaction.
- The verified login session already contains userId, employeeId, and username. Users columns A:D hold User ID, Employee ID, Username, and Full Name.
- No inspected sheet has an encoder field. Attendance's Employee ID and Leave Requests' Employee ID identify the subject of the record. Leave Requests already records the reviewer's employee ID in Reviewed By, with Reviewed At.
- Sales, collections, branches, programs, and program-incentives POST handlers do not currently validate the session. The page proxy explicitly excludes API routes, so protecting the pages alone does not protect those saves.

## Implemented columns

These four columns follow each sheet's existing business columns:

1. **Encoded By User ID** — stable account identity, referencing Users column A.
2. **Encoded By Employee ID** — staff identity, referencing Users column B.
3. **Encoded By Username** — readable snapshot of the username at encoding time.
4. **Encoded At** — server-generated UTC ISO timestamp, distinct from OR Date, DOI, Date Remitted, or Attendance Date.

| Live sheet tab | Existing data columns | New encoder columns |
| --- | --- | --- |
| Members | A:AD | AE:AH |
| Member programs | A:N | O:R |
| Sales | A:AQ | AR:AU |
| Remittances | A:F | G:J |
| Collections | A:U | V:Y |
| Programs | A:F | G:J |
| Program Incentives | A:H | I:L |
| Branches | A:M | N:Q |
| Employee Branches | A:C | D:G |
| Users | A:H | I:L |
| User Roles | A:B | C:F |
| Attendance | A:R | S:V |
| Leave Requests | A:K | L:O |

For attendance edits, also append **Updated By User ID**, **Updated By Employee ID**, and **Updated By Username** in W:Y; reuse the existing Updated At column R. Preserve original encoder columns during edits. For leave reviews, retain Reviewed By/Reviewed At and preserve the original encoder. If generic leave editing is introduced, give it separate updated-by fields.

Roles has no creation route in the inspected application; if one is added, use H:K for encoder fields. Beneficiaries currently has no headers or corresponding persistence path, so define its business columns first.

## Tracking behavior

- Require a valid server session before any mutation. Return HTTP 401 when unauthenticated. Never accept encoder identity from submitted form fields or use the selected MAS as the encoder.
- Capture the actor and timestamp once per submission and pass them to every related row, including all items in a batch.
- Append the fields in the same Sheets write as the business row so an entry is not saved without its encoder.
- Append headers without shifting existing columns: current readers use numeric column positions. Verify headers before writes and expand grid width where necessary; Members and Sales currently end at their last business column.
- Use the exact live tab name `Member programs` when migrating headers.
- Preserve existing timestamps for compatibility. Encoded At gives all sheets a consistent, explicit tracking timestamp, including Members, which has no creation timestamp today.
- For usernames written with USER_ENTERED, ensure they remain literal text, including names beginning with `=`. Stable user and employee IDs remain the authoritative identifiers.
- Leave historical encoder cells blank unless an independent, reliable audit record establishes who entered the row. Do not infer the encoder from MAS or assign old rows to the user performing the migration.
- Test unauthenticated saves, attempted client-side encoder spoofing, new and existing member sales, collection batches, and attendance edits preserving the original encoder.
- This records the creator and, where applicable, the last editor. A complete edit history would require a separate append-only audit log. Direct manual spreadsheet edits do not pass through application tracking.

## Review utility

`node scripts/inspect-sheet-headers.mjs` reads tab names and header rows using the configured service account with a read-only scope. It does not print credentials or read member/account data rows.

## Implementation and validation

- `lib/encoder-context.ts` verifies the login before each mutation handler and carries one actor and timestamp through the entire request using AsyncLocalStorage. Existing role permission checks remain in place.
- `lib/encoder-sheets.ts` checks the tracking headers and appends the encoder in the same write as each business row. It rejects writes without a verified encoder. Attendance updates write only business columns and latest-editor columns; leave reviews update only their existing business/reviewer columns.
- All ten business POST handlers use the encoder wrapper. Read operations and authentication endpoints do not create encoder records.
- `scripts/migrate-encoder-tracking.mjs` checks every target tab before modifying anything, rejects conflicting headers or occupied unlabelled columns, expands column capacity if necessary, and adds headers in a single batch request. It is safe to rerun.
- Run `npm run sheets:encoder` for a dry run; use `npm run sheets:encoder -- --apply` to migrate another configured spreadsheet.
- Run `npm run test:encoder` for the mocked integration tests. These cover all unauthenticated mutation routes, spoofed encoder input, new/existing member sales, collection batches, concurrent users, all configured column layouts, preserved original encoders, and existing permission checks. They do not write test transactions to the live spreadsheet.

The live spreadsheet migration is complete. The application code must run from this updated checkout (or be deployed to the hosted application) for new submissions to populate the tracking fields. Manual edits made directly in Google Sheets are outside this application tracking.
