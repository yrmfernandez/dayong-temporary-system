# Supabase migration plan

Drafted October 4, 2026; updated October 5, 2026. Moves the operational database from Google Sheets to PostgreSQL on Supabase.

**Status: every page runs on the database on the `supabase` branch (October 5, 2026); ready for cutover** (see [Cutover](#cutover-steps)). The live system (`main`) runs on Google Sheets until the branch is merged. See [Status by module](#status-by-module) for what is done, partly done, and still to do, and [Progress](#progress) for the dated log.

## Why

Measured on the live spreadsheet on October 4, 2026:

| Measure | Value |
| --- | --- |
| Tabs | 45 (28 registered in `config/sheet-database-schema.json`) |
| Data rows | about 90,000; Collections alone 59,947 |
| Cells used against Google's 10 million limit | 4.06 million |
| One full read of Collections | about 22 MB, about 3 seconds |
| Full Collections reads per Collections save | 2 (account data, then the OR-number check), plus Members and Member programs |

The Sheets API cannot run a query such as "only this member's rows", so every lookup downloads the whole tab. Saves skip the cache on purpose, so validation always sees current data. The cache is per Vercel instance and is empty after a cold start. Tuning can roughly halve the save cost, but the cost still grows with the ledger. PostgreSQL answers indexed lookups in milliseconds whatever the size.

PostgreSQL also fixes two correctness gaps that Sheets cannot close:

- **Write locks.** `withWriteLock` serializes saves only inside one server instance. Two Vercel instances can still both accept the same OR number at the same moment. In PostgreSQL a unique index plus a transaction rejects the second one, on every instance.
- **Cache freshness.** Another instance can serve data up to about a minute old. Without a large cache there is nothing to invalidate.

## Target setup

| Piece | Choice | Reason |
| --- | --- | --- |
| Database | Supabase PostgreSQL, region **Southeast Asia (Singapore)** | Closest to Manila. The free tier has 500 MB; current data needs an estimated 50–100 MB with indexes. |
| App hosting | Vercel as now, function region **`sin1`** (Singapore) | Keeps every query on a short network hop. |
| Connection | Supabase pooler (Supavisor), transaction mode, port 6543 | Serverless functions open many short connections; the pooler shares them. |
| Query layer | **Drizzle ORM** with `drizzle-kit` migrations | Typed TypeScript schema, plain SQL migration files kept in git, no heavy runtime. |
| Sign-in | **Keep the current system** (bcrypt passwords, signed session cookie, `proxy.ts`) | It works and is tested. Supabase Auth would change every login and is not needed. |
| Receipt photos | Supabase Storage, private bucket `receipts`, short-lived signed URLs | Photos stay out of the database. The 1 GB free storage holds about 12,000 photos at 80 KB. |
| Staging | A second free Supabase project | Every schema change and the cutover are rehearsed there first. |

**Security rule:** Supabase publishes a public REST API for tables in the `public` schema. The app reads the database only from the server, so **every table gets row-level security switched on with no policies**, which blocks the public API completely. The server connects with the database password, kept only in Vercel environment variables.

## Phases

Estimates assume one developer working with Claude Code. **New feature work is paused from phase 1 until cutover**, so everything moves in one switchover (decision 1).

### Phase 0: Preparation (1–2 days)

1. Create the production and staging Supabase projects in Singapore. Set Vercel's function region to `sin1`.
2. Add environment variables: `DATABASE_URL` (pooler), `DIRECT_DATABASE_URL` (migrations), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Storage only).
3. Run `npm run sheets:audit` and clear every error and type warning that would block import.
4. Register the 17 tabs missing from `config/sheet-database-schema.json`: Remittance Methods, Pay Profiles, Payroll Runs, Payroll Lines, Payroll Adjustments, Audit Log, Daily/Weekly/Monthly/Yearly Audits, Member Transfers, Program Categories, System Settings, Receipt Photos, Report Notes, Bank Deposits, Legacy Repairs.

### Phase 1: Schema (2–3 days)

1. Write the Drizzle schema for every table, generated from the sheet schema file and checked by hand.
2. Types: IDs and phone numbers as `text` (keeps leading zeroes), money as `numeric(12,2)`, calendar dates as `date`, moments as `timestamptz`, breakdowns and snapshots as `jsonb`.
3. Foreign keys between parent and child tables (member → enrollment → collection, remittance → remittance link, user → user role, and so on).
4. Indexes for the lookups that are slow today: collections by enrollment, member, encoder, OR date, remittance status, and created time; sales by encoder and application number.
5. Rules that the code enforces by hand today become constraints:
   - OR number unique among posted collections (partial unique index).
   - Application number unique.
   - Amounts greater than zero.
6. **Audit Log as a database trigger.** Every update and delete writes the old and new row and the acting user into `audit_log`. The app sets the actor per transaction (`set_config('app.actor', …)`), replacing `withEncoder` and `runAsSystem` plumbing for audit purposes. No write can skip the audit.

### Phase 2: Data access layer (3–5 weeks, the main work)

47 files call Google Sheets directly, about 150 call sites, mostly reading rows by column position (`row[28]`). Each module is rewritten to typed queries **behind the same exported function names**, so pages and API routes barely change.

Order, by how slow each part is today:

1. `lib/account-data.ts`, `lib/duplicate-entries.ts`, Collections API
2. Sales, `lib/remittance-workflow.ts`, `lib/remittance.ts`, receipt photos
3. Members, member directory, member transfers, `lib/member-scope.ts`
4. Today's Entries, My Entries, clerk reports, `lib/clerk-cash.ts`, exceptions, date checks
5. MAM, statement of account, executive dashboard, `lib/reports.ts`
6. Users, roles, sessions, employees, Employee ID changes (the cascade becomes `ON UPDATE CASCADE` foreign keys)
7. Attendance, calendar, leave, payroll, finance, fidelity, audits, settings

Each save becomes one transaction, which replaces `withWriteLock`. Database code goes through `lib/db.ts`: `getDb()` for reads and `inTransaction()` for saves, which also names the signed-in user for the audit trigger. Tests use PGlite, a real PostgreSQL inside the test process built from `db/migrations`, so no test touches staging. `SheetsReadCache` is removed except for a small cache for rarely changing lists (Programs, Branches, System Settings).

Work happens on a `supabase` branch, merged once at cutover. **No dual writing to Sheets and the database:** keeping two stores in step is where data gets lost.

### Phase 3: Copy script (2–3 days)

`scripts/copy-sheets-to-postgres.mjs`:

1. Reads each tab, converts values with the schema types, and inserts parents before children.
2. Can be rerun: it empties the target tables first, so it serves for rehearsals and for the final copy.
3. Checks itself. For every table it compares row counts, and for every money table it compares totals between the sheet and the database, and stops on any difference.
4. Decodes each receipt photo from the `Receipt Photos` cells, uploads it to Storage, and stores the file path.
5. Prints counts and totals only, never member names or details.

Legacy Pending NS, Legacy Pending COLL and Legacy Repairs are not copied (decision 2). The app never reads them; only the legacy scripts do. At cutover they move to their own working spreadsheet, **Dayong Legacy Pending**, so the frozen archive stays untouched. `scripts/migrate-legacy-members.mjs` and `scripts/merge-legacy-mas.mjs` are rewritten to read that spreadsheet and write resolved rows into the database, still deleting each imported row from its pending tab.

### Phase 4: Testing (1 week)

1. Run the existing test suite against the staging database.
2. **Report comparison:** for several past periods, produce the clerk reports, MAM, statements of account, and remittance totals from Sheets and from staging, and diff them. Any difference is a bug in phase 2.
3. Have one Entry Clerk and one approver use staging for a day with copied data.
4. Rehearse the full cutover on staging twice and time it.

### Phase 5: Cutover (one evening or weekend)

1. Announce the window. Put the app in maintenance mode (read-only).
2. Copy the three legacy tabs to the Dayong Legacy Pending spreadsheet and check row counts. Then make the main spreadsheet view-only for the service account and rename it with a "frozen" date. Keep it for one year (decision 3).
3. Run the final copy and confirm every count and total check passes.
4. Deploy the `supabase` branch. Smoke test: sign in, save a collection, attach a photo, approve a remittance, open a report.
5. **Go/no-go point:** if anything fails before users start saving, deploy the previous version. The frozen sheet is unchanged, so nothing is lost. After users save new data in the database, roll forward with fixes instead.

### Phase 6: After cutover (2–3 days)

1. Remove the Sheets wrapper, cache, write locks, and the Sheets-only migration scripts.
2. **Backups:** schedule a nightly `pg_dump` with GitHub Actions to private storage, and keep 30 days. Confirm what the current Supabase plan includes, since full backups and point-in-time restore are paid features.
3. **Nightly Sheets export** (decision 4): a scheduled job copies every table into a separate export spreadsheet. It is a view-only copy shared only with the owner and the administrator. Edits made there never flow back; all changes go through the app.
4. Update the system guide, code reference, and this document.

**Total: about 6–9 weeks.**

## Costs

| Stage | Plan | Notes |
| --- | --- | --- |
| Start | Free | 500 MB database, 1 GB storage. A free project pauses after a week without use, which daily use prevents. Up to 2 free projects, enough for production and staging. |
| When needed | Pro, about USD 25/month | Upgrade in place, no data move. Triggers: database near 500 MB, photos near 1 GB, or wanting automatic daily backups. |

Prices are as of the 2026 drafting and should be checked on supabase.com/pricing before deciding. At current volumes the database itself should stay under 500 MB for a long time; photo storage will likely be the first reason to upgrade.

## Changing the database later (adding or removing columns)

Yes, and it is safer than in Sheets. Today a new column shifts positions such as `row[28]`, which is why the AO column needed its own migration. In PostgreSQL the code uses column names, so a new column never moves another.

Every change is a migration file in git:

1. Change the Drizzle schema in `db/schema.ts`, for example add `receipt_checked boolean not null default false` to `collections`.
2. `npm run db:generate` writes the SQL file (`ALTER TABLE collections ADD COLUMN …`). Review it.
3. Apply to staging with `npm run db:migrate`, test, then apply to production the same way with production's `DIRECT_DATABASE_URL`. A migration that adds a table ends with `SELECT attach_audit_triggers();` so the new table is audited too.

| Change | How | Notes |
| --- | --- | --- |
| Add a column | `ADD COLUMN`, with a default if old rows need a value | Instant even with millions of rows. Apply the database change **before** deploying code that uses it. |
| Remove a column | Deploy code that no longer uses it, **then** `DROP COLUMN` | The reverse order breaks the running app. Take a backup first; the data is gone after the drop. |
| Rename a column | `RENAME COLUMN` with a matching code deploy | Or add the new name, copy data, switch code, drop the old name, to avoid any downtime. |
| Change a type | `ALTER COLUMN … TYPE … USING …` | PostgreSQL rejects the change if any value cannot convert, so bad data never slips in. |
| Add a table | `CREATE TABLE` | Same as adding a tab today. |

Migration files keep a full history of every schema change, and staging catches mistakes before production does.

## How the remaining pages moved (October 5, 2026)

To go live quickly, the pages not yet rewritten were moved with a compatibility layer instead of module by module: `lib/sheets-on-db.ts` answers the Google Sheets API calls (`values.get`, `batchGet`, `append`, `update`, `batchUpdate`, `spreadsheets.get`, row deletes) from the database, and `lib/google-sheets.ts` sends every application tab there. This works because each table has the same columns in the same order as its tab (checked October 5, 2026), and `row_seq` (migration `0005`) keeps rows in the order they were added, so "row 5 of Remittances" means the same row. Only the Legacy Pending tabs still go to Google Sheets.

- Remittances, Today's Entries, My Entries, Exceptions, receipt photos, record corrections, Entry Clerk reports, Report Review, Audits, dashboards, sign-in and accounts, roles, attendance, leave, payroll, fidelity, finance and settings all read and save in the database through this layer, unchanged.
- Writes run in one transaction that names the signed-in user, so the database audit trigger records every edit and delete (the old sheet-based audit writer is no longer used).
- Reads are cached for 10 seconds per server and cleared after every database save.
- Reads never join a transaction (only the layer's own writes use one, passed explicitly), and the database client sends one query at a time per connection (`max_pipeline: 1` in `lib/db.ts`): with pipelining, Supabase's transaction pooler left concurrent reads waiting forever (found October 5, 2026 when Attendance and Payroll never loaded).
- Absence close-out and other multi-row appends insert in one statement.
- Receipt photos are files in Supabase Storage, private bucket `receipts` (`lib/photo-storage.ts`, October 5, 2026); `receipt_photos` keeps which entries each covers and the file path. Photos saved before that are moved by `scripts/move-photos-to-storage.mjs`. The server needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (production values in Vercel Production).
- The pages that used the most Vercel Active CPU now let the database filter first (`readSheetRows`, `countSheetRows` in `lib/sheets-on-db.ts`), measured October 5, 2026 on staging (second call):
  - Audits (`/api/audit`, 19 min of CPU in 12 calls before): about 0.5 s. Each clerk's report used to convert every New Sale and Collection ever recorded; `getEntriesForRange` (`lib/todays-entries.ts`) now loads only the clerk's, person's or date range's rows.
  - Today's Entries 0.2 s, My Entries and Entry Clerk reports about 0.5 s (about 40 s before).
  - Dashboard (`/`, 9 min of CPU in 122 calls before): about 0.8 s. Recent activity takes the newest 40 rows in scope, members are counted in the database, the month report (`lib/reports.ts`) loads only the month's rows, and the remittance summary uses a read-only ledger without the 59,000 imported, already remitted collections (`loadLedger({ activeOnly })`).
  - Remittances page about 0.1 s.
- Exceptions loads only accounts with new (non -LEG-) entries, each with its whole history, unless old data is included; History reads only the newest rows of each tab (it shows the newest 2,000).
- Remittance saves (create, approve or reject, auto-submit, resubmit) read only the active Collections and Sales, like the dashboard: the database numbers each returned row with its position in the whole table (`readSheetRowsNumbered` in `lib/sheets-on-db.ts`), so updates by position still hit the right row. Done October 5, 2026. Remittances and Remittance Collections are still read whole (their size on production not yet checked).
- Vercel Hobby includes 4 hours of Active CPU a month; 3 hours were used by October 5, 2026, mostly by Audits and the dashboard before these changes.

## Status by module

Updated with every change on the `supabase` branch. "Done" means the module reads and saves through `lib/db.ts` and its tests run on PGlite; it still waits for cutover like everything else.

### Done

| Area | Files | Notes |
| --- | --- | --- |
| Database layer | `lib/db.ts`, `db/schema.ts`, `db/migrations/0000`–`0004` | Transactions name the signed-in user for the audit trigger; data helpers join the open transaction (`currentDb`). |
| Copy from Sheets | `scripts/copy-sheets-to-postgres.mjs` | Dry run by default; verified load into staging. |
| Tests on PostgreSQL | `scripts/test-encoder-tracking.cjs` | PGlite built from `db/migrations`, emptied before each test. |
| Collections save | `app/api/collections/route.ts`, `lib/account-data.ts` | Locks only the batch's accounts; one transaction. |
| Account status, MAM, member MAM, member standing | `lib/account-data.ts`, `lib/mam-report.ts`, `app/api/mam`, `app/mam/page.tsx` | MAM is chosen in order: branch, then a MAS or employee assigned to it, then a member (dropdown with search); only that slice is loaded (MATINA, 650 accounts: about 1.2 s from Manila). Without a branch nothing loads, except for a MAS, who sees their own members. Member pages load only that member's accounts. |
| Duplicate checks | `lib/duplicate-entries.ts` | OR number, Application Number and returning person: only the numbers or people being saved. |
| New Sales save | `app/api/sales/route.ts`, `lib/member-records.ts` | Member, enrollment, sale and beneficiaries in one transaction. |
| Member search and lookups | `lib/member-records.ts`, `app/api/members`, `app/api/member-programs/check`, `app/api/sales/validate` | Collections lists every member of the chosen Branch and MAS (`/api/members?all=1`); typing narrows the list at once. The MAS list is every active employee assigned to the branch, MAS or not (owner's rule, October 5, 2026). |
| Members directory | `lib/member-directory-data.ts`, `lib/member-directory.ts`, `app/members/page.tsx` | Filters, sort and paging run on the server; the browser receives 25 members per page, and payment statuses are worked out only for them (or, for the payment-status and Forfeited filters, only for the members the other filters leave). A MAS's request loads only their own accounts and members. |
| Member transfers | `lib/member-transfer.ts` | MAS change and history saved together; the change is in the Audit Log. |
| Statement of account | `lib/statement-of-account.ts` | Loads one account, its member and its New Sale. |
| Member edit and delete | `lib/master-data-crud.ts` | Program and branch delete checks look at enrollments in the database. |
| Branches | `lib/google-sheets-data.ts` (`getBranches`, `createBranch`), `lib/master-data-crud.ts` | Unique-name check and the in-use check (assignments, enrollments) in the database. |
| Employees and branch assignments | `lib/employees.ts` | An employee and their assignments save together. Users (sign-in) are still in Sheets, so ID clashes and linked accounts are checked there. |
| Programs and incentive tiers | `lib/google-sheets-data.ts` (`getPrograms`, `createProgram`, `getProgramIncentives`, `addProgramIncentive`), `lib/program-incentive-store.ts`, `lib/master-data-crud.ts` | A program and its tiers save in one transaction. |
| Program categories | `lib/program-categories.ts` | |
| Remittance methods | `lib/remittance-methods.ts` | |
| Employee ID change | `lib/employee-id-change.ts` | Database part in one transaction (linked tables follow the employee row; every other `*employee_id` column and report note keys rewritten); Users and other tabs still in Sheets are updated as before. |

### Partly done

| Area | What is left |
| --- | --- |
| `lib/master-data-crud.ts` | User accounts (`getUserAccounts`, `updateUserAccount`, `resetUserPassword`) still use Sheets; they move with sign-in (step 2). |
| Master data readers in reports | `lib/dashboard-data.ts`, `lib/executive-analytics.ts` and the Audit Log page (System Health's database, schema and Audit Log checks use `lib/db.ts` since October 6, 2026; its account and role checks still go through the Sheets layer) still read Employees, Branches and Programs from Sheets, so their counts do not include changes made on this branch. They move in steps 5 and 6. |
| `lib/entry-corrections.ts` | Duplicate checks use the database, but the correction itself still edits the Sales and Collections sheet rows. Must move with Remittances (step 4 below). |

### To do, in order

Steps 1 to 7 below are covered for going live by the compatibility layer above; they remain as follow-ups for speed (targeted queries instead of whole-table reads). Step 8 waits until those rewrites are done.


1. **Rest of master data**: system settings and holidays (`lib/system-settings.ts`, `lib/attendance-calendar.ts`). Branches, employees, programs, categories and remittance methods are done (October 5, 2026).
2. **Sign-in, users and roles**: Users, Roles, User Roles (`lib/users-sheet.ts`, `lib/roles.ts`, the account functions in `lib/google-sheets-data.ts` and `lib/master-data-crud.ts`), `app/api/auth/login`, `lib/session-account.ts`, `app/api/settings` (password change).
3. **Receipt photos** to Supabase Storage: `lib/receipt-photos.ts`, `app/api/receipt-photos`.
4. **Remittances and corrections**: `lib/remittance-workflow.ts`, `lib/remittance.ts`, `lib/entry-corrections.ts`, `lib/record-corrections.ts`.
5. **Entry views and checks**: `lib/todays-entries.ts`, My Entries, `lib/exceptions.ts` (also lists open `copy_exceptions` and flagged legacy duplicates), `lib/date-checks.ts`, `app/api/history` (Audit Log page reads `audit_log`).
6. **Reports and dashboards**: `lib/clerk-report.ts`, `lib/clerk-cash.ts`, `lib/report-remarks.ts`, `lib/daily-audit.ts`, `lib/reports.ts`, `lib/dashboard-data.ts`, `lib/executive-analytics.ts`, `lib/company-targets.ts`.
7. **HR and finance**: `lib/attendance-data.ts`, `lib/attendance-calendar.ts`, `lib/auto-absence.ts`, `lib/leave-data.ts`, `lib/payroll.ts`, `lib/fidelity.ts`, `lib/finance-data.ts`, `lib/finance-operations.ts`.
8. **Remove the Sheets layer**: `lib/google-sheets.ts`, `lib/sheets-read-cache.ts`, `lib/encoder-sheets.ts`, `lib/sheet-rows.ts`, `lib/system-health.ts` Sheets counters, `app/api/google-sheets/test`, and the `sheets:*` scripts.
9. **Phases 4–6**: report comparison, staging trial, cutover rehearsals, cutover, nightly backups and Sheets export, documentation (system guide, code reference).

### Speed on the branch (October 5, 2026)

Three causes were found; all are addressed on the branch:

1. **Master data came from Google Sheets** on every encoding page (about 3 seconds when the cache was cold). Fixed: branches, employees, programs, incentive tiers, categories and remittance methods are read from the database.
2. **The Members page loaded everything**: every member, and every payment to work out every account's status (measured from Manila: payments 1.6 s and 16.6 MB, accounts 0.4 s, members 0.4 s). Fixed: the server filters, sorts and pages, and works out statuses only for the 25 members shown. Filtering by payment status or Forfeited still works out statuses for every member the other filters leave, so it is slower without a branch, MAS or program chosen.
3. **Server region.** The functions ran in Washington, D.C. (`iad1`) while the database is in Singapore. Owner's step (October 5, 2026): set Vercel → Settings → Functions → Function Region to Asia Pacific → Singapore (`sin1`). It applies to the next deployment of the live site as well as previews. The live site still uses Google Sheets, which work from any region.

Pages that still read Sheets keep their old speed until their step: **Remittances** (step 4), **Today's Entries, My Entries, Exceptions** (step 5), **dashboards, Entry Clerk reports, Report Review and Audits** (step 6), attendance, payroll and finance (step 7). The owner reported dashboards, reports, Report Review, Audits and Remittances as slow on October 5, 2026; steps 4 to 6 are next.

### Known gaps on the branch until cutover

- **The system is not in daily use yet** (owner, October 5, 2026): no live transactions are being recorded. Previews touching the live spreadsheet carry little risk, and cutover does not need a quiet window or a rollback period; it can happen as soon as the remaining steps are done and checked.
- **Vercel previews of this branch** are kept on purpose (owner's choice, October 5, 2026). Production deploys from `main` only. A preview uses the Preview environment variables: if those include the production Google Sheets settings, saving on a page that still uses Sheets changes the live spreadsheet, so treat previews as live for those pages. On this branch `DATABASE_URL` is a required setting (`lib/server-environment.ts`), so without it in Vercel's Preview environment even sign-in stops with "Missing server environment variable: DATABASE_URL". Use staging's value, never production's, and redeploy the preview after adding it: a variable reaches only deployments built after it is saved.
- Sign-in accounts created **in the app on this branch** (Employees → register) are saved to the Users sheet, while the employee is saved to the database. That is expected until step 2.
- Remittances, Today's Entries, My Entries, reports and dashboards still read Sheets, so they do not show Collections or New Sales saved on this branch.
- The system guide and topic docs still describe the live system on Google Sheets. They are rewritten for the database in phase 6, at cutover.

## Running a script on production (from October 6, 2026)

`.env.local` always stays on **staging**; never edit it to reach production. Production values live in `.env.prod-scripts` in the project folder (ignored by git, like every `.env*` file), one per line:

```
DATABASE_URL=<production transaction pooler, :6543>
DIRECT_DATABASE_URL=<production session pooler, :5432>
SUPABASE_URL=https://qnugejonwpfvsenxvhxz.supabase.co
SUPABASE_SERVICE_KEY=<production service_role key>
```

Then prefix any command with `npm run prod --`, for example `npm run prod -- node scripts/fill-member-contacts.mjs --apply` or `npm run prod -- npm run db:migrate`. `scripts/prod.mjs` checks that the values name the production project, prints `PRODUCTION (qnugejonwpfvsenxvhxz)`, and gives the values to that one command only. A command without the prefix uses staging. The `$env:` routine below is how cutover was done; it still works but is no longer needed.

## Cutover steps

The system is not in daily use yet, so cutover needs no quiet window. The owner runs steps 1 to 3, so the production password never leaves their computer.

1. **Prepare the production database** (PowerShell in the project folder, production values from the password manager; they override `.env.local` only in this window):
   ```powershell
   $env:DATABASE_URL = "<production transaction pooler, :6543>"
   $env:DIRECT_DATABASE_URL = "<production session pooler, :5432>"
   $env:SUPABASE_URL = "<production project URL>"
   npm run db:migrate
   node scripts/copy-sheets-to-postgres.mjs
   node scripts/copy-sheets-to-postgres.mjs --apply --yes
   ```
   The dry run must report no problems before `--apply`. The load checks row counts and money totals for every table and undoes itself on any difference. Close the window afterwards so `.env.local` (staging) applies again.
2. **Vercel → Settings → Environment Variables**: add `DATABASE_URL` with the production transaction pooler value, environment **Production** only. Keep the Google variables: the Legacy Pending tabs and the legacy scripts still use them.
3. **Merge** `supabase` into `main` (GitHub pull request, or `git switch main`, `git merge supabase`, `git push`). Vercel deploys production with the database.
4. **Smoke test** on the live site: sign in, open Members, MAM, Collections (save a test batch), New Sales, Remittances, Today's Entries, an Entry Clerk report, Report Review, Audits and the dashboard. Delete test entries afterwards.
5. **From then on**, nobody edits the application tabs in the Google Sheet; they are an archive (decision 3). The Legacy Pending tabs stay in use there.

## Progress

| Date | Step | Result |
| --- | --- | --- |
| Oct 4, 2026 | Phase 0: Supabase projects (production, staging) in Singapore; staging in `.env.local` | Connections and secret key checked |
| Oct 4, 2026 | Phase 0: `npm run sheets:audit` | 0 errors; 16,901 type warnings, all handled by the copy (see below) |
| Oct 4, 2026 | Phase 1: `db/schema.ts`, migrations `0000_initial_schema`, `0001_audit_trigger`, applied to staging | 42 tables with row-level security, 41 audit triggers, no API-role access; rules checked in a rolled-back test |
| Oct 4, 2026 | Phase 1: migrations `0002_employee_branch_unique`, `0003_copy_exceptions` | One branch assignment per employee and branch; table for cells the copy could not convert |
| Oct 4, 2026 | Phase 3: `scripts/copy-sheets-to-postgres.mjs` first full load into staging | 32 s; row counts and money totals match for every table; database 51 MB. Sample lookups 66–137 ms from Manila, including the network trip (one Collections read from Sheets: about 3 s) |
| Oct 4, 2026 | Phase 2, step 1: `lib/db.ts`; account data, OR and application-number checks, and the Collections save read and write the database | A Collections batch locks only its accounts and saves in one transaction; tests run on PGlite (in-process PostgreSQL built from the same migrations); 120 pass |
| Oct 5, 2026 | Phase 2, step 2: New Sales save, member search and lookups (`lib/member-records.ts`), duplicate-person check; migration `0004_member_program_unique` | A New Sales batch saves in one transaction (before, a failure could leave half a batch); database rules on member number, Application Number and one enrollment per member and program stop racing saves; 120 tests pass |
| Oct 5, 2026 | Phase 2, step 3: Members directory (`lib/member-directory-data.ts`), member transfers, statement of account, member edit and delete | A MAS's directory request loads only their own members; transfers save the MAS change and history together; the SOA loads one account; 121 tests pass |
| Oct 5, 2026 | Collections member list: every member of the chosen Branch and MAS, searchable; speed findings recorded | 121 tests pass |
| Oct 5, 2026 | Master data: branches, employees and assignments, programs and tiers, categories, remittance methods, Employee ID change; Members page filters and pages on the server; Function Region change to Singapore handed to the owner | Tests read master data from h.rows and copy it into PGlite before each route call (`syncMasterData` in the harness); 121 tests pass |
| Oct 5, 2026 | Fix: the Collections member list gave every member every program of the branch and MAS (a Drizzle subquery compared the enrollment with itself), so no program was auto-selected. Each member now gets only their own programs (one is selected automatically; several are chosen by the clerk). Collections panels contain their own scrolling and the account summary stays pinned above the history. MAM rebuilt as branch → MAS / employee → member, loading only that slice | Regression test added; checked against staging; 121 tests pass |
| Oct 5, 2026 | Compatibility layer `lib/sheets-on-db.ts`; migration `0005_row_order_and_photo_data` (row_seq on every table, receipt photo data columns); `lib/google-sheets.ts` sends every application tab to the database; copy script includes receipt photos | Every page reads and saves in the database; new test for reads, appends, updates, deletes and the audit trigger; 122 tests pass |
| Oct 5, 2026 | Cutover done: `supabase` merged into `main`; production database migrated and loaded. New on `main`: migration `0006_notices_to_explain` (NTE), Day Off in Attendance Review, branch-first Members filter | Production needs `npm run db:migrate` before this deploy (the Cutover steps' PowerShell values); 124 tests pass |
| Oct 5, 2026 | Data fixes and follow-ups: the 14 unreadable Collections OR dates set to the recorded date (else Date Remitted) on production and staging (`scripts/fix-copy-exception-dates.mjs`); 16 birthdate items remain in `copy_exceptions`. Receipt photos moved to Supabase Storage. Exceptions and History read less. The copy script refuses the production database. Legacy import routed to the database (`npx tsx … migrate-legacy-members.mjs`); dry run: 0 of 63 pending accounts pass (61 are D-210 flexible-payment accounts, waiting for the flexible program rules) | 124 tests pass |
| Oct 5, 2026 | Flexible programs: `programs.flexible` (migration `0007_program_flexible`), Programs switch, rules in account-rules, remittance, Collections, New Sales and Exceptions | Production needs `npm run db:migrate` before this deploy; 125 tests pass |
| Oct 5, 2026 | OR branch letters: `scripts/fix-or-letters.mjs` adds the letter only where certain (same booklet within 50 numbers, or a branch with one letter at least 95% of the time), written "12345 S"; staging: 1,305 fixed. The rest show in Exceptions as "OR numbers without a branch letter". Application numbers confirmed text everywhere. Legacy import reads the flexible flag: with D-210 HG flexible (minimum 150, total 25,200), the staging dry run passes 31 of 63 accounts; the other 32 have underpayments on fixed programs or bad dates and stay pending | Production: run fix-or-letters `--apply` once only; 125 tests pass |
| Oct 5, 2026 | Legacy import `--apply` ran against **staging** by mistake: 22 members, 31 enrollments, 214 collections written there and removed from the Legacy Pending tabs. `scripts/copy-legacy-import.mjs` copies exactly those rows (IDs in `backups/legacy-migration-ids-2026-10-05T09-39-36-262Z.json`) from staging to production | Done: 267 rows copied to production (22 members, 31 enrollments, 214 collections). The other 32 pending accounts stay in the Legacy Pending tabs for review |
| Oct 5, 2026 | Remittance saves read only active Collections and Sales (about 1,000 instead of 60,000 rows), with row positions counted by the database | 126 tests pass |
| Oct 5, 2026 | 3:00 PM cutoff: incentive deadline moved from 10:00 AM to 3:00 PM the day after the OR date; nobody can save New Sales or Collections from 3:00 PM to midnight (pages and save routes) | 127 tests pass |
| Oct 6, 2026 | Member contact from claimant: `scripts/fill-member-contacts.mjs` fills a blank member contact with the claimant's number (at least 7 digits) in Members and Sales; staging: 2,698 members and 2,719 New Sale records filled, 8,379 members have no number at all. The legacy import does the same for new rows. Legacy dry run: 0 of the 32 pending accounts pass, so nothing more to import | **To do:** run on production (dry run, then `--apply`) |
| Oct 6, 2026 | Production runner: `.env.local` stays on staging; `npm run prod -- <command>` runs one command with the production values from `.env.prod-scripts` (`scripts/prod.mjs`) | Checked with sample values: production passes through, a staging value is refused |
| Oct 6, 2026 | MAS New Sales submissions: table `sale_submissions` (migration `0008_mas_sale_submissions`, 45 tables), Submit New Sales page for MAS, Submitted by MAS tab on New Sales for the branch's clerks; the clerk's save marks the submission Saved in the same transaction. Test harness reads System Settings (the SOA test needed it after the signatories change) | Staging migrated (9 of 9). **To do:** `npm run prod -- npm run db:migrate` before pushing; 128 tests pass |
| Oct 6, 2026 | Optional maximum monthly payment for flexible programs: `programs.max_monthly_payment` (migration `0009_program_monthly_maximum`), Programs Yes/No choice, Collections and first-month New Sale validation. Existing programs default to no maximum. Report dark-mode readability and Day Off tracking are documented in the system guide. | Migration generated locally, not applied to staging or production in this change. Run `npm run db:migrate` against the intended environment before deploying. 27 targeted payment and attendance tests pass. **Pushed before the migration ran:** production pages that read Programs fail with "Failed query" (column `max_monthly_payment` missing). **To do:** `npm run prod -- npm run db:migrate`, and `npm run db:migrate` on staging (still at 9 of 10). |
| Oct 6, 2026 | IT System Health reads the database instead of Google Sheets: database response time and connections, size against the Supabase Free 500 MB limit, largest tables, schema check (every table and column in `db/schema.ts` must exist; migrations in `db/migrations/meta/_journal.json` must be recorded in `drizzle.__drizzle_migrations`), which Supabase project the deployment uses, receipt photo storage settings, and the Audit Log read 10 rows at a time instead of whole. Account and role checks unchanged | Queries checked on staging; it would have flagged the missing `programs.max_monthly_payment` column. First Vercel build failed type check (two errors hidden locally by a broken `.next/dev` types file); fixed, full type check (without `.next`) and lint pass |

Phase 1 also replaced step 4 of phase 0: the Drizzle schema in `db/schema.ts` now describes every table, so the 17 unregistered tabs were not added to `config/sheet-database-schema.json`.

### Data findings (October 4, 2026)

Counts only; no member data was read out.

- **OR numbers** are text such as `12345 A`, `12345A` or `0123`. They are stored exactly as typed; `or_key` holds the spaceless upper-case form the duplicate rule compares (`lib/duplicate-entries.ts` `entryKey`).
- **Existing duplicates:** 735 Collections rows repeat an earlier OR number (729 receipts, created March to September 2026), and 61 Sales rows repeat an application number (18 numbers used twice, and one placeholder-like number used 44 times). Decision: copy them unchanged, set `legacy_duplicate` on the second and later copies so the unique rule skips them, and list them on the Exceptions page. New entries can never reuse those numbers.
- **Old employee IDs** (confirmed by the owner): DPE-0001 is MD-2026-0001 and DPE-0007 is MD-2026-0004. The copy rewrites DPE-0001 to MD-2026-0001 in the 28 `encoded_by_employee_id` cells where it appears. The 25 Employee Branches rows for DPE-0007 repeat MD-2026-0004's 25 branch assignments exactly, so they are left out rather than renamed. An employee can now hold each branch once (`employee_branches_employee_branch_key`); no other duplicate pairs exist.
- **Links:** every other reference (enrollment, member, program, employee, branch, role) points to an existing row.
- **Unreadable dates:** 30 cells have a 3-digit year (8 member birthdates, repeated on the same people's 8 Sales rows, and 14 Collections OR dates). Decision: copy them as blank and keep the original text in `copy_exceptions` for correction later. Phase 2 lists open copy exceptions on the Exceptions page with a way to correct the record and mark it resolved.
- **Volume:** about 6,600 Collections a month. Receipt photos at up to 80 KB each would reach the 1 GB free storage in a few months if most entries get a photo, so plan for Pro (100 GB) once photo use is steady.

## Decisions (October 4, 2026)

1. **One switchover.** Everything moves at once. Feature work pauses until cutover, and there is no period where some modules use Sheets and others use the database.
2. **Legacy Pending tabs stay in Google Sheets** until every account is resolved, in the separate Dayong Legacy Pending spreadsheet. Resolved rows are imported into the database.
3. **The frozen spreadsheet is kept for one year** after cutover as a read-only archive, then deleted after a final download.
4. **Nightly Sheets export** for the owner and the administrator only.
5. **Old duplicate OR and application numbers** are kept, flagged and listed for review rather than fixed before cutover.
6. **Unreadable dates** are copied as blank, with the original text kept for review.

## What the owner provides before phase 0

1. Two Supabase projects (production and staging) in Southeast Asia (Singapore), in a **Dayong** organization created with the owner's work email and two-factor authentication. A second Owner (company or administrator email) is invited to the organization when one is available, so access never depends on one person.
2. Their connection strings and service keys, added to Vercel and `.env.local`, never committed.
3. A date for the cutover evening, after the feature freeze starts.
