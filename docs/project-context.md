# Dayong System project context

## Upgrade list (agreed 2026-10-24, done one at a time)

The owner asked what to upgrade next; these were agreed to be worked through one by one, in this order unless the owner changes it.

| # | Upgrade | Status |
| --- | --- | --- |
| 1 | Clock-in location check: branch office locations, flag clock-ins away from the branch or with location off for HR | **Built 2026-10-24**; owner migrates production, deploys, then sets each branch's location (Branches → Branch locations for clock-in) |
| 2 | Nightly scheduled jobs: account-status sync, end-of-day absences, Exceptions, so dashboards are never stale | **Built 2026-10-24**; owner sets CRON_SECRET on Vercel and deploys |
| 3 | Finish finance links: vendor payments, direct commission payments, Fidelity withdrawals and payroll company-program deductions create cash records | **Built 2026-10-24**: vendor, commission and Fidelity payouts record cash; payroll company-program deductions listed until their Collection is linked (owner chose the reminder list) |
| 4 | Member data correction tool: move receipts between programs, shift NOP/coverage, merge/split members from an admin page with a reason and audit trail | **Built 2026-10-24**: Member Corrections page with fix coverage, move receipts, insert missing receipt, merge and split |
| 5 | Keep the program rate on each entry so editing a program does not change old installments in MAM/SOA | **Built 2026-10-24** (option 1, owner): Base Pay, flexible and registration fee locked once a program has collections |
| 6 | Move the main multi-step saves off the Sheets-style layer (`lib/sheets-on-db.ts`) into database transactions | **Built 2026-10-24, complete**: every save (payroll, clerk cash, finance, audits, calendar, settings, roles, remarks, remittances, attendance, leave, user accounts, corrections, targets) writes by ID in one step or one transaction; only reads remain on the Sheets layer |
| 7 | One time zone (Manila) for every report date | **Built 2026-10-24**: one helper (`lib/manila-date.ts`) turns stored UTC times into Manila dates everywhere; Company report, SOA, dashboards and lists fixed |
| 8 | Join reports by ID instead of branch/MAS/encoder names | **Built 2026-10-24**: MAS/Collector dashboards and Report Review clerks picked by Employee ID (`lib/person-scope.ts`), unlinked old names still count by name |
| 9 | More automated tests on the money rules (incentives, remittance expected amounts, NOP, forfeiture) | **Built 2026-10-26**: `scripts/test-money-rules.mjs` (centavo invariants over 1,000+ combinations, rounding, ORC, reactivation, flexible splits, New Sale, forfeits, short months, Fidelity base and withdrawals) and deadline-to-the-minute tests |
| 10 | Watch the Supabase 500 MB Free-plan limit as receipt photos grow; plan Pro or archiving | **Built 2026-10-26** (owner is on Supabase Pro): System Health measures against 8 GB database / 100 GB Storage, shows photos still in the database, and the nightly job records sizes for growth per month and months left (`lib/capacity.ts`) |

### MAS submit Collections from their phone; My Members on a phone (2026-10-31)

- **Owner:** in MAS, add Collections: the MAS chooses the member and how many months were paid, by batch; the day they add the member is the OR date; they cannot add a member without clicking Waiver; the incentive is calculated for them; phone friendly, My Members too; the clerk side like New Sales (a new tab). Asked how cash remitted after 3:00 PM is handled.
- **Owner chose:** Waiver required only on accounts suspended on the OR date (today's rule; Visitation Form still not a substitute); the clerk types the OR numbers.
- **Owner, follow-up:** the MAS cannot edit, withdraw or mark a batch handed over (they might claim it before remitting); editing is the clerk's. Like Clearing, the clerk marks the batch remitted when the cash comes in, because the OR numbers may be typed after 3:00 PM. The clerk can still change the Date Remitted with a reason (no work, day off, on leave).
- **Built (see system guide § 4, Collections submitted by a MAS):** Submit Collections page (`/mas-collections`), Collections → Submitted by MAS tab, sidebar counts, migration `0036` (`collection_submissions`). **Mark remitted** (records a Clearing for the MAS at that moment, or links today's when it is the same cash; the batch is saved under it, so its time decides the incentive), **Reject** before it is marked. Also: a member cannot be in two waiting submissions, Collected by locked to MAS and only that MAS's handover accepted when the clerk reviews. My Members: rows become cards on a phone, tap-to-call contact, filters fold away.
- **After 3:00 PM:** the deadline is 3:00 PM the next working day after the OR date, judged at the handover time; Mark remitted records that time, so OR numbers typed later keep the incentive. The MAS sees the deadline and, once marked, whether it was in time.
- **Status:** built and checked (type check, lint, tests, build); not yet tried on staging. **To do (owner):** `npm run db:migrate` on staging and `npm run prod -- npm run db:migrate` on production **before** pushing; a MAS role whose page access was set in Roles needs **Submit Collections** ticked.
- **Suggested, not built:** "Add to batch" straight from the MAM To collect list; a photo of the signed Waiver attached by the MAS; letting the MAS type a different amount on flexible programs (today the clerk changes it).

### Old records taken back out of the clerks' October reports (2026-10-31)

- **Owner:** remaining cash on hand is too big and some reports are inaccurate; then, after the Mintal comparison: "let's just revert what we did to week 1, let's not continue adding it to this month."
- **Found (production, read only):** the report adds up correctly (Remaining Cash on Hand = Cash In − expenses − cash forwarded to bank, not carried). Weeks 1-2 were off because the old records added on Oct 29 (`scripts/complete-old-site-reports.mjs`) brought the entries but almost none of the cash going out: the clerks' weekly sheets' own deposits were never in the old web app (Mintal Oct 1-10: 3 of 15 deposits, ₱2,472.50 of ₱42,242.50; the ₱800 driving fee missing), Fidelity was not in the workbook import, one GCash transfer split across MAS was imported whole on each (Ambasing, about ₱29,500 too much), and old web app deposits went to whoever typed them while collections went to the branch's clerk. Mintal's sheet entries were under Caballero, Jenny. From week 3, clerks record the MAS bank / GCash payments as deposits but mostly not the cash handed to the office (some type "TO MAIN OFFICE" or "COH" as the bank), so that cash stays on hand.
- **Owner chose:** revert the completion; keep the incentives recalculated on Oct 30.
- **Done:** `scripts/revert-old-site-reports.mjs` (plan by default, `--apply` in one transaction, Record Corrections row): the New Sales and Collections the completion gave a clerk get back their encoder and encoded date from the audit log (an entry changed in those columns since is listed, not touched), and its expenses (`EXP-WEB-`, `EXP-LEG-`) and remittances (`DEP-WEB-`) are deleted (the audit log keeps each deleted row). **Applied on production:** 177 New Sales and 1,683 Collections back as before (none changed since), 48 expenses (₱139,297.74) and 57 remittances (₱150,313.42) deleted; a second plan finds nothing left. Weeks 1-2 now show only what clerks encoded in the system; a few week 3 figures changed too (old-sheet entries and expenses timestamped Oct 12-17, e.g. Garcia's expenses ₱15,260 → ₱5,020). `complete-old-site-reports.mjs` refuses a month listed in `config/old-site-report-clerks.json` "reverted" (2026-10).
- **Open (owner):** cash handed over to the office has no place of its own on the report (only Cash forwarded to bank); a "Cash turned over to office" line was suggested, not built.

### Weekly and monthly reports submitted by the clerk (2026-10-30)

- **Owner:** the clerk chooses the weekly's range, submits it, and cannot edit it unless it is returned; the monthly reflects the weeklies, from the day after the previous month's report to the last weekly submitted.
- **Owner chose:** a weekly starts the day after the last one and the clerk picks only its last day (up to today; the first one's start is chosen); a monthly can be submitted once all its weeklies are approved; review as Audits today (HR and Finance prepare and may return; only an Administrator approves); a monthly is for the month most of its days fall in.
- **Done:** migration **0035** adds `end_date`, `month_label`, `submission` (Submitted / Returned), submitted and returned by/at and `return_reason` to the period audit tables. `lib/report-periods.ts`: `periodView` (the submitted report containing a day, or the new one), `submitPeriod`, `resubmitPeriod`, `returnPeriod`, `monthOfMost`. The submitted report is its audit's row. `buildClerkReport` takes the span (a monthly's rows are its weeklies); `lib/daily-audit.ts` audits weekly/monthly by the submitted row (only submitted, not returned ones; approval needs a saved audit), and `reportLockProblem` locks a submitted one's days until returned. Reports: weekly/monthly picker, Submit, Submit again with the reason (`components/clerk-report.tsx`); Audits: the clerk's own dates, Not submitted list, Return to clerk (`app/audit/page.tsx`, `PATCH /api/audit` decision `return`). Deposits on a weekly/monthly must fall in its dates (`reportTo`). `scripts/check-database.mjs` checks 0035. Production had no weekly or monthly audits, so nothing to convert.
- **Tests:** the whole flow (first weekly with its start chosen, next one fixed, dates refused, lock, monthly refused until approved, return with reason, fix, submit again, HR saves, Admin approves, an approved one cannot be returned, monthly submitted for October with two weeks). All 283 tests and the build pass.
- **To do (owner):** `npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs`, **before** deploying. Not checked in a browser: as a clerk, Reports → Weekly → New weekly report, choose To, Submit; as HR, Audits → Weekly → Return to clerk.

### Weeks 1 and 2 of October: old-workbook entries repriced with the current rules (2026-10-30)

- **Owner:** the report for October's 1st week (and the 2nd) is inaccurate, like the incentives.
- **Found (production, read only):** the reports add up: for every clerk the Oct 1-4 weekly report equals the sum of the daily reports and the database. The old-workbook entries (`-LEG-` IDs) filed under the clerks on Oct 1-11 mostly have no company share (the workbook had none), so their incentive shows as zero (e.g. Pañares week 1: 42 collections, ₱42 incentive; ₱2,775.60 by the rules); a few recorded the whole payment as incentive. Old web app and newly encoded entries match the rules.
- **Owner chose:** recalculate only the old-workbook entries recorded Oct 1-11 with today's program rules.
- **Done:** `scripts/reprice-legacy-weeks.mjs`: plan (read only, prices each entry as `repriceEntries` does) and `--apply` (one `repriceEntries` call in one transaction; gross, receipts and cash unchanged; forfeited / No incentive stay remitted whole). Production plan: 1,686 entries, 1,634 to recalculate, incentive ₱6,511.60 → ₱118,558.90 (gross ₱602,370 unchanged). Two collections are left as they are because their program has no MAS tier for NOP 2: COL-LEG-2117DD0F9A (Ambasing, Oct 10) and COL-LEG-20D0D07643 (Pañares, Oct 9).
- **Applied on production** (checked 2026-10-31: incentive ₱118,558.90; kept when the old records left the clerks' reports, see above). Before: `npm run prod -- node scripts/reprice-legacy-weeks.mjs --apply`. Fix the NOP 2 tier of those two entries' programs in Programs if they should earn an incentive.

### Old-site member Crispin Coffreros Santander imported with receipt 24619 C (2026-10-30)

- **Owner:** check whether CRISPIN COFFREROS SANTANDER is in the database; then check the receipts around his; then assign him the missing receipt and import him.
- **Found:** not in the database. On the old web app: member 1504 (Calinan, MAS Percy Cagaanan), New Sale 1506 (DS-320, Sep 1, 2026), collection 1327 (receipt 24618 C, Sep 30, ₱320). The October 8 import left the sale and collection out because 24618 C is already Ivy Bangkil's D-230 ₱230 receipt (COL-LEG-D4629426A8, from the old workbook). Percy's Calinan booklet runs 24601-24622 C; on Sep 30 it has 24617, 24618 and 24620 C, and 24619 C is nowhere in either system.
- **Done on production:** the owner assigned **24619 C** to collection 1327. `scripts/migrate-legacy-site.mjs --corrections` now also takes a reviewed receipt number (`expectedOr` must match the export, `orNumber` the new one); correction in `config/web1327-crispin-receipt-correction-20261030.json`. Run `--collection-ids=1327 --corrections=…` (dry runs on staging and production, then `--apply` on production): 1 member MEM-WEB-1504 (PH-21056033), account ENR-WEB-1506 (DS-320, Active), New Sale SALE-WEB-1506, collection COL-WEB-1327 24619 C (Remitted, not a duplicate). Not applied on staging.

### Two handovers: the picker shows which one already has its batch (2026-10-30)

- **Owner:** CABILAN, LOTSMAN was refused with "already has a Collections batch ... clear again in Clearing first" although there were two clearings; it happens after saving a batch and encoding the same MAS again.
- **Found:** a saved batch leaves its clearing Open until it is sent for approval, so after the first save both handovers looked the same in From Clearing (same name, both Open). Picking the one already used was refused, correctly, but the message asked for a new clearing that already existed. The server rule itself is right: the other handover saves (tested).
- **Done:** `getEncodableClearings` adds `batchWaiting` (kinds with a batch of that clearing waiting or returned, `batchesWaitingFor`); the picker lists that handover last with "batch already saved, waiting for approval". `waitingBatchProblem` with a picked clearing names the free handover: "The clearing picked is X's 1st handover (14:41), which already has a Collections batch waiting ... Pick their 2nd handover (15:18) in From Clearing". No migration.
- **Not checked:** the live clearings and batch for CABILAN (database access was not allowed here). All 282 tests and the build pass.

### Report weeks start on the 1st and end on the month's last day (2026-10-30)

- **Owner:** the start of the week is the first day of the month, and the end as well: the first week of October starts October 1. Chosen: Monday to Sunday, cut at the month (October 2026: Oct 1-4, 5-11, 12-18, 19-25, 26-31).
- **Found:** the weekly report and audit ran a full Monday to Sunday, so the week of October 1 was Sep 28 - Oct 4; week N was the week of the Nth Monday.
- **Done:** `lib/report-week.ts` (`reportWeek`) used by `periodSpan('weekly')` (weekly report, weekly audit, its notes, Cash Beg and deposit days) and This week on Company Reports and My Entries; `weekOfMonth` counts the same weeks (October 12 is now the 3RD WEEK, a month can have a 6TH). The monthly report's week rows follow. No migration.
- **Saved weekly items:** weekly audits, notes and Cash Beg are keyed by the week's first day. A week that used to cross months (e.g. saved under Sep 28) now covers only its own month's days (Sep 28-30); Oct 1-4 is a new week with nothing saved yet. Weeks inside one month are unchanged.
- **Tests:** week numbers and spans (Oct 1-4, Oct 26-31, Sep 28-30, Nov 30 = 6TH WEEK), the October 1 weekly report heading. All 282 tests and the build pass.
- **Not checked in a browser:** Reports → Weekly, choose October 2.

### Every page follows the open workspace, including the virtual MAS (2026-10-30)

- **Owner:** the MAM upgrade should also apply to the virtual MAS in the workspace. And when changing workspace, pages do not behave as that workspace's role (an Administrator in their Entry Clerk workspace still sees Reports as an Administrator); fix it for all pages and roles.
- **Found:** only the dashboard read the `dayong_role` cookie; every API and page check used all of the session's roles.
- **Done:** `lib/workspace-session.ts` (`sessionForWorkspace`): a held role → that role only, its own permissions (new `rolePermissions` in the session, from Roles at sign-in and each 5-minute recheck; older sessions keep the combined ones until then) and its page access; MAS (not held, not executive-only) → virtual MAS with no permissions; anything else unchanged. `realAccess` keeps the real roles and `canAccessPath` requires both. Applied in `getSessionUser` (every API and the dashboard), the proxy's page check (not the lunch-break exception), and the sidebar (`app-shell`). `getRealSessionUser` for `/api/auth/session` (returns `user` real + `active` workspace) and the password change (re-issues the token); `createSessionToken` refuses a narrowed view. Settings' Organization tab and the OR-without-letter check follow `active`. No migration.
- **Behaviour change:** a user with several roles now uses one role's powers at a time (e.g. Entry Clerk + Finance approves remittances in the Finance workspace only).
- **Tests:** narrowing (Entry Clerk workspace loses Administrator pages, permissions and actions; virtual MAS; HR's MAS workspace never gains MAS-only pages; unheld, empty, malformed and executive cases unchanged; old sessions), MAM in the virtual MAS (own members, no Sync). Also fixed the lunch-break test, which failed whenever it ran during the real 12:00–12:59 PM break (its last check used the real clock; now pinned to 1:30 PM). All 282 tests and the build pass.
- **Not checked in a browser:** sign in as an Administrator who also holds Entry Clerk, open the Entry Clerk workspace, then Reports.

### MAM for MAS users upgraded (2026-10-30)

- **Owner:** the MAM, in the MAS users: update it, upgrade it. Chose all four: collection list, phone cards, simpler filters, member payment card.
- **Done:** `lib/mas-collection.ts` (`collectionList`: owes this month when next month due ≤ this month and not ADV / Fully Paid / Forfeited; to collect = months from next due through this month × monthly; sorted by forfeit date; close to forfeiting = within 31 days) and `components/mas-collection-list.tsx` at the top of MAM for a MAS; `buildMamReport` rows carry `current` (today's `accountState`) and `currentError`. MAS view: title My Members' Accounts, no Branch / MAS / Member pickers, plain labels (Collected, Amount Due, Collected vs Due, Totals), phone cards below md. Payment card (`components/mam-member-card.tsx`) replaces the Account Details drawer for everyone. Status colours moved to `components/mam-status.tsx`. **Fixed:** a MAS could press Sync Statuses, which rewrites every account's stored status company-wide; hidden for MAS and refused by `POST /api/mam` (403). No migration. Tests: collection list (60D, ADV, NS this month, 150D close to forfeit with waiver) and the sync refusal; all 281 tests and the build pass.
- **Not checked in a browser:** no MAS sign-in here; to see it, sign in as a MAS and open MAM (on a phone for the cards).
- **To confirm with owner:** To collect counts every month owed through this month (a 60D member paid through August owes Sep–Oct, ₱700 at ₱350), which can be more than the status's Amount due (overdue months only).

### Error handling: crash screen, page not found, network failures (2026-10-30)

- **Owner:** do we have error handling, loading states and graceful failures? Then: do it.
- **Found:** API routes and most screens already report errors and show loading/busy states; missing were a crash screen (`error.tsx` / `global-error.tsx`), an in-app 404, and network-failure handling on six screens.
- **Done:** `app/error.tsx` (inside the app: Try again via `retry`, Go to dashboard, Reference digest), `app/global-error.tsx` (own document, theme and styles, full reload to `/`), `app/not-found.tsx`. Roles, My Notices, NTE panel, Cash accounts (finance-settings, Save now disabled while saving), Remittance methods: every load/save wrapped, replies read with `readApiResponse`, busy always cleared. Sidebar Sign out: a failed logout shows a dialog and stays put (the session cookie was not cleared). No migration.
- **Not tested in a browser:** the crash and 404 screens are checked by the build only; to see them, open a mistyped address while signed in.

### Fidelity: the ₱10,000 is no longer locked (2026-10-30)

- **Owner:** in Fidelity we don't lock the 10k. It can be withdrawn by percentage or fixed; the excess is a different withdrawal; and a whole Fidelity withdrawal.
- **Done:** `lib/fidelity-cap.ts` — `fidelityStanding` gives base (first ₱10,000), excess and remaining (no lock, no separation condition); `baseWithdrawalAmount` turns a percentage of the base held, or a fixed amount, into pesos (never above the base). `withdrawFidelity` (`lib/fidelity.ts`) takes `kind` base (with `mode` percent/fixed), excess or full, for active and departed employees alike; a percentage is stored in the notes ("50% of ₱10,000.00"). Fidelity Monitoring: **Withdraw base** (Percent / Fixed ₱ with the pesos it pays), **Withdraw excess**, **Withdraw all** on every employee with a balance; columns Base and Excess; history shows withdrawal notes. My Fidelity says nothing is locked. Old Separation Release rows still count as paid out. No migration. Tests: money rules for the base and percentages; a payout test for an active employee (excess, 50% of base, fixed, full, each in the cash ledger); all 279 tests and the build pass.
- **To confirm with owner:** a base withdrawal while there is excess (₱13,000, 50% of base = ₱5,000) leaves ₱8,000, shown as all base: the balance is one amount, base and excess are not kept as separate pockets.

### Returned batch: ORC and the other encoding marks can be fixed; program on the New Sale row (2026-10-29)

- **Owner:** when a remittance is rejected, the clerk cannot change ORC (true or false); add it and anything else not yet editable. Then: in New Sales, the program can be edited too.
- **Done:** My Entries → Edit batch (`lib/batch-edit.ts`, `components/batch-editor.tsx`) now edits **ORC** (checkbox under Collected by, Collector batches only), and per entry **No incentive** with its reason (both kinds; not on DTO batches); Collections also **Reactivation**, **Transferred** and **Waiver (if suspended)**. The remittance is worked out again as when encoding: ORC lives in the remittance breakdown; ORC with a reactivation, or ORC on a non-Collector batch, is refused; unmarking No incentive clears its reason and the forfeited amount; a changed Waiver re-checks the payment. Each change is in Record Corrections. A New Sale's **program** is now chosen on its row (it was only under Details; still fixed once the account has collections). No migration. Test extended; all 278 tests and the build pass.

### Two handovers a day before encoding: the clerk picks the handover (2026-10-29)

- **Owner:** Clearing says "already cleared"; **New handover: clear again** appears only once the earlier clearing is encoded, but clerks sometimes need to clear a MAS more than once a day before encoding. Asked which time each batch should then get: **the clerk picks**, with a clear sign of which is which.
- **Done:** migration **0034** adds `clearing_id` to `sales` and `collections`. `addClearing` (lib/clearing.ts) asks "Already cleared today" for an Open (not yet encoded) clearing too, instead of refusing; `editClearing` no longer refuses a second clearing of a kind. Each clearing of a person, branch and day is numbered (`withHandovers`: **1st handover of 2**, badge on the Clearing page; picker label `MAS · 2nd handover (3:18 PM)`). New Sales and Collections send the picked clearing; the save checks it (`pickedClearingProblem`) and keeps it on every entry. The picked clearing's time is the time received (`receivedAtOf` via `pickedClearings`), progress follows it (`withProgress`), the double-entry check counts only that handover (`waitingBatchProblem`), and sending the batch closes only that clearing (`closeClearings`). Batch edit drops the link when the MAS or Date Remitted changes. Entries saved before this, and MAS submissions saved without a pick, follow the old time rule. `scripts/check-database.mjs` checks 0034. Test added; all 278 tests and the build pass.
- **To do (owner), in order:** `npm run prod -- npm run db:migrate` (applies 0034), then `npm run prod -- node scripts/check-database.mjs` (0034 present, OK), then deploy; staging: `npm run db:migrate`.

### PH-67986231 shows D-180 in Collections instead of DC-180 (2026-10-29)

- **Owner:** why does Collections take PH-67986231 as D-180 and not DC-180?
- **Found (new read-only `scripts/inspect-account-program.mjs`, staging; production to confirm):** the member has two accounts, both from the old sheets and never changed here: ENR-LEG-4708B211A2 **DC-180** (6 receipts, Jan 31–Sep 16, 2026) and ENR-LEG-FD41656464 **D-180** (2 receipts, Feb 26 and Jul 7, 2026). The old sheet labelled those 2 receipts D-180, so the import made a second account. The import mapping is right (`DC-180` and `C-180` → DC-180). Collections offers both accounts; it picks one only when the member has a single program.
- **Production differs:** only ENR-LEG-4708B211A2 **DC-180** is listed under the number (U; 8 old-sheet receipts Jan 31–Sep 16 plus 1 encoded Oct 2; Fix coverage by Maintenance Admin Oct 29 14:19). Staging is an older copy, so the D-180 receipts were already on DC-180 there.
- **Done:** the script (accounts linked to the member or saved with the number, a different number saved on an account, program changes, corrections, receipts and New Sales by program, deleted or moved-away accounts in the Audit Log). No app change, no migration.
- **In progress:** rerun on production with the wider search; owner to say where D-180 still shows (member pick, program list, history, or a message).

### PH-20172465 still Forfeited: old-system hold (2026-10-29)

- **Owner:** PH-20172465 is still Forfeited although it should be updated; then: list the other accounts like it.
- **Found (read-only `scripts/inspect-account-status.mjs`, production):** ENR-LEG-234F5F8223 (DF-650) has `forfeit_held` (Forfeited carried from the old system, not in the Audit Log); its 8 receipts (Feb–Sep 2026, NOP 2–9) give **U** (paid through Sep 29). Production: 607 stored Forfeited, 4 held only by the old-system mark. Not a bug: the hold works as decided on Oct 26.
- **Done:** the script now also prints each held account's member number, account, program and status from the receipts alone. No app change, no migration.
- **To do (owner):** reopen PH-20172465 in Member Corrections → Fix coverage with the start unchanged (preview shows Forfeited → U; the "Nothing changes" summary only means no receipt is renumbered), with a reason; decide on the other 3 one by one.

### Opened views update live too (2026-10-29)

- **Owner:** live updates work, but an expanded view does not change (e.g. a member's name edited by another user changes in the Members list, not in the opened details); same on other pages.
- **Cause:** pages kept a copy of the row taken when it was opened (Members details, MAM member detail, payroll payslip), so a reload refreshed the list only; MAM even closed its open detail on every live reload. Several panels load their own data and never listened for changes.
- **Done:** after a live reload the opened row is replaced by its reloaded version (Members, MAM: the detail stays open now; payroll payslip follows the reloaded run; the open payroll run reloads). Live refresh added to the member MAM panel, remittance View entries and Why the difference, Fidelity, Notices to Explain, gross sales breakdown, My attendance history, Attendance Tracking and the attendance sheet. Edit forms and the Clearing day-end review are left alone so typing or choices are not lost. System guide (Live updates, item 3) updated. Build passes.
- **In progress (owner):** deploy; with two users, open a member's details on one and rename the member on the other.
- **To do:** none.

### Undo a remittance approved by mistake (2026-10-29)

- **Owner:** an admin approved a remittance that should have been rejected; an accidental approval must be revertible.
- **Done:** an Administrator can **Undo approval** on an Approved slip (Remittances → Reports → Remittance Records), with a reason. The slip returns to Pending Approval (Discrepancy when short or over) with the decision cleared, its entries to Pending Remittance Approval, and a turnover short or over its approval settled is open again; then it is rejected or approved in the usual way. The reason is added to the slip's remarks. Refused when an entry left the slip after approval, or when turnover cash settled on that approval is in an approved clerk report. Approval only marked the slip and its entries (cash ledger, Fidelity savings, Clearing and reports read them live), so nothing else needs reversing. `undoRemittanceApproval` (lib/remittance-workflow.ts), `reopenVariance` (lib/turnover-variance.ts), `PATCH /api/remittances` `decision: "undo"`; system guide section 6, step 5. Build passes.
- **In progress (owner):** deploy (no migration needed), then on the slip approved by mistake: Undo approval with the reason, then Reject it with the rejection reason.
- **To do:** none.

### October monthly reports completed with the old web app and old sheet records (2026-10-29)

- **Owner:** the system was started around the 2nd week of October, so the clerks' October monthly reports are incomplete; complete them from the data (branch, dates, MAS). Decided: collections go to the branch's clerk assigned today, and where a clerk has several branches the owner names the clerk per branch; old-site expenses and bank remittances are imported too; each record counts on the day it was created on the old site.
- **Found:** the gap is the old web app (records created Oct 1-10). In the export: 40 New Sales (the member record names the Encoder), 122 Collections (no encoder: only Branch, Agent, Collector), 40 expenses and 57 bank/GCash remittances (with Encoded By, never imported). The imported New Sales and Collections (`SALE-WEB-…`, `COL-WEB-…`, all Remitted) have no clerk, so no report counted them.
- **Done:** `scripts/inspect-month-coverage.mjs <YYYY-MM>` (read only: entries by source, encoder, branch, week; Entry Clerks and branches). `scripts/complete-old-site-reports.mjs` with `config/old-site-report-clerks.json`: dry run by default; gives each imported New Sale its old-site Encoder (same-day member record, else the branch's clerk) and each Collection its branch's clerk, encoded on the old-site day at noon Manila; adds expenses as `EXP-WEB-…` and remittances as `DEP-WEB-…` under their Encoded By clerk (types in `skipExpenseTypes` left out; incentive-like types flagged); never changes an entry that has an encoder; re-runs skip what is done; one Record Corrections row per run. `--apply` is refused while any branch, name or branch spelling is unresolved; `--apply --rollback` tests the writes and undoes them (tested on staging: 19 New Sales, 34 expenses, 50 remittances written and rolled back; nothing kept).
- **Old sheet added (owner: it may hold data from October 1):** the sheet has no encoder column. Its New Sales and Collections imported as `…-LEG-…` that were created in the month (sheet Timestamp) and have no clerk go to the branch's clerk on that day; its Expenses Entry rows of the month are added as `EXP-LEG-<row>` under the branch's clerk. In `2026 DATABASE (NS + COLL).xlsx` (Oct 21 download), October rows by Timestamp: about 1,600 collections, 136 New Sales, 8 expenses; the dry run shows how many of them are in the system. Names now match without accents or hyphens (Pañares = Panares).
- **Owner's branch clerks (in the config):** BUHANGIN, MATINA, AGDAO, TIBUNGCO → MD-2026-0077; DIGOS, STA. CRUZ → MD-2026-0057; TORIL, BALIOK → MD-2026-0081; COMPOSTELA, MONKAYO, MONTEVISTA → DNDO-2026-0075; CALINAN → DNDO-2026-0002; PANTUKAN → DNDO-2026-0003; MINTAL → MD-2026-0078; NABUNTURAN, MAWAB, MARAGUSAN → DNDO-2026-0082; TAGUM, MACO, LA FILIPINA → DNDO-2026-0003; CABADBARAN, BUTUAN, RTR → MD-2026-0083; HINATUAN, TAGBINA → SDS-2026-0010.
- **Owner's other answers:** old-site encoder 118 RYE-EL N/A ABAS has no employee record, so those records go to their branch's clerk (`encoders` value "branch"). Expenses ORC MAAM PIPAY and RELEASE ORC TO MAAM PIPAY are recorded under the account ORC, SERVICES INCENTIVE 10% under SERVICES MAS INCENTIVES (`expenseAccounts`); they are imported, not skipped.
- **Production dry run (Oct 29):** old sheet 137 New Sales and 1,562 Collections of the month in the system with no clerk; to give a clerk or add: 143 New Sales (106 old sheet), 1,378 Collections (1,257 old sheet), 48 expenses (8 old sheet), 57 bank/GCash remittances; 11 clerks; 1 old-site record not in the system.
- **In progress:** none; every open point is answered in the config.
- **To do (owner):** `npm run prod -- node scripts/complete-old-site-reports.mjs` (expect Unresolved records: 0), then `… --apply --rollback` (test), then `… --apply`; open one clerk's October monthly report to check. If the old site was used after Oct 10, re-export it first (`scripts/legacy-site-export.mjs`) and import any new New Sales and Collections (`migrate-legacy-site.mjs`).

### Turnover short/over in the Entry Clerk report, settlement, and the audit gate (2026-10-29)

- **Owner:** the entries are usually right and the MAS gave or added up the wrong amount. Show the short/over in the report, not as a balance; a report can be approved only when it is balanced or its discrepancies are settled.
- **Done:** migration 0033 adds `settlement`, `settled_cash`, `settled_on` to `turnover_variances`. Remittances: a pending slip shows its turnover short/over; approving it asks whether the cash changed hands now (Yes, MAS paid / Yes, returned / No cash), then the explanation; such slips are approved one at a time (`settleCash` in the PATCH, `decideVariance`). A partly corrected batch keeps the difference left. Entry Clerk report (`lib/clerk-report.ts`, `components/clerk-report.tsx`): Cash In lines **Turnover short/over** and **Turnover settled**, plus a table of each one. Audits (`decideDailyAudit`): approval refused while a turnover difference on the clerk's batches in the period is open.
- **Tests:** the turnover test now also checks the report (Collection Net 350, short −50, Cash In 300), the audit refusal, settlement Paid by MAS ₱50 (Cash In 350) and the audit approval after. Full suite and build: see the reply.
- **In progress:** none.
- **To do (owner), in order:** `npm run prod -- npm run db:migrate` (applies 0032 if not yet, and 0033), then `npm run prod -- node scripts/check-database.mjs` (49 tables, 0033 present), then deploy; staging: `npm run db:migrate`.

### Control total: turnover sheet short or over is allowed and traced (2026-10-29)

- **Owner:** in the control total, allow over or short so it can be traced easily; add ideas to make it easy to trace and fix. Decided: any amount saves as usual (no limit, note optional); the slip goes to Discrepancy.
- **Done:** a mismatch no longer refuses the save (`controlTotalProblem` only asks for a missing total; `controlTotalDifference` / `controlTotalStatus` in `lib/entry-controls.ts`). Both forms use `components/control-total-field.tsx`: Matches (green) or Short by / Over by ₱X (amber) with where to look, and an optional note; the review before saving repeats it. The APIs record the difference in the new table `turnover_variances` (migration 0032, `lib/turnover-variance.ts`) in the batch's own transaction: kind, entry IDs, branch, MAS, Date Remitted, control total, total remittance, difference (− short, + over), note, clerk.
- **Trace and fix ideas built in:** (1) the automatic slip records the cash at the turnover amount, so it is a **Discrepancy** that needs an explanation to approve; the explanation settles the variance. (2) The Discrepancy breakdown lists the turnover cause first and names any entry whose share equals the difference (likely doubled or missing receipt). (3) Rejected and corrected in My Entries: the next slip recomputes from the corrected entries, and a match settles it as "Entries corrected". (4) **Exceptions → Turnover sheets short or over** lists open ones with MAS, clerk, note and slip. (5) Slip remarks carry "Turnover sheet short by ₱X (TOV-…)".
- **Tests:** new test (save short, variance row, Discrepancy slip 350/300, remarks, breakdown, Exceptions, approval needs explanation, settled, matching batch records nothing); old refusal assertions updated.
- **In progress:** none.
- **To do (owner), in order:** `npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs` (49 tables, 0032 present), then deploy; staging: `npm run db:migrate`. Possible follow-ups: show the short/over on the Entry Clerk report and on My Entries.

### Collections: one Waiver for several receipts of an account in a batch (2026-10-28)

- **Owner:** the NOP is already solved when a member has several receipts in a batch; do the same for the Waiver: once it is selected it should not ask again.
- **Done:** `chainSameAccount` (app/collections/page.tsx) also marks `waiverAbove` on each later receipt for the same member and program after one with Waiver selected; that receipt skips the If Suspended question and its check, shows "Waiver selected on the earlier receipt for this account", and is sent with Waiver. Clearing the earlier Waiver asks again. The server (app/api/collections/route.ts) carries the Waiver to later receipts of the same account in the batch and saves it on record. New test: a suspended account with two receipts, Waiver on the first only, saves both with Waiver (refused when neither has it).

### Traced: Charnny Ambasing's pending cash (2026-10-28)

- **Owner:** trace Ambasing Charny's report: why does it have Pending cash, to be encoded?
- **Done:** traced read-only on production. "Pending cash, to be encoded" is never counted from entries; it is the amount typed in the report's Notes (`report_notes.pending_cash`). MD-2026-0002 typed ₱18,842 herself on her CALINAN daily report of Oct 28, 2026 at 5:15 PM; it is the only notes row of hers with pending cash. Without it her Remaining Cash on Hand would be ₱18,812 (Cash Beg 9,450 + Sales Net 5,900 + Collection Net 22,113.70 + Fidelity 22.10 − Expenses 9,450 − Bank 9,223.80), so she most likely typed her cash on hand there, which counts it twice (Remaining shows ₱37,654). New read-only `scripts/inspect-clerk-pending-cash.mjs <name>`. No app change.
- **To do (owner/clerk):** ask her what the ₱18,842 is; if it is her cash on hand, she clears Pending cash in Notes and saves.

### Entry Clerk report: one deposit reference on several deposits, today only (2026-10-28)

- **Owner:** in the Entry Clerk's report allow multiple reference numbers / remarks for TODAY only.
- **Done:** `duplicateReferenceProblem` / `assertReferenceFree` (`lib/clerk-cash.ts`) take the deposit date: when the deposit and the other deposit with that reference are both dated today (Manila), the reference may repeat (adding or editing). A reference on a deposit of another day, or a today's reference used on another day, is still refused (the October 23 double-count rule). Test extended; all 275 tests and the build pass.
- **In progress:** none.
- **To do (owner):** deploy.

### Late-entry reason no longer asked again after a changed Date Remitted (2026-10-28)

- **Owner:** when the Entry Clerk changes the Date Remitted it asks for a reason, then every entry asks again for a late-entry reason.
- **Done:** `lateCheckDay` / `lateEntryReason` (`lib/entry-controls.ts`): with a Date Remitted earlier than today changed with a reason, each receipt is judged from the Date Remitted, not today; it needs its own reason only when its date is more than one working day before the Date Remitted (held long by the MAS). Covered entries store "Date Remitted changed: <reason>" as their late-entry reason, so Exceptions still shows why. Used in the Collections and New Sales forms and their saves (`app/api/collections`, `app/api/sales`). Tests added; all 275 tests and the build pass.
- **In progress:** none.
- **To do (owner):** deploy.

### Lunch break lock, 12:00–12:59 PM (2026-10-28)

- **Owner:** from 12 noon to 1 PM nobody can do anything in the system: a big Lunch Break screen that cannot be closed and disappears by itself after 12:59. Decided: everyone, Administrators too; the server refuses saves as well; clocking in or out still works. Then: Administrators get an urgent-fix button that lets them use the system, and the screen pops up again every 3 minutes.
- **Done:** `lib/lunch-break.ts` (12:00–13:00 Manila, the attendance lunch break `BREAK_START`/`BREAK_END`). `components/lunch-break-screen.tsx`, mounted in the app shell: full-screen LUNCH BREAK with a countdown to 1:00 PM, no close button, the page under it `inert` (no clicks, typing or focus; what was typed stays), not shown on `/attendance` (button **Go to Attendance (clock in / out)**), goes away at 1:00 PM by itself; uses the server clock (`GET /api/server-time`), not the computer's. Administrators: **Urgent fix (Administrator)** hides it for 3 minutes, then it comes back. `proxy.ts`: during the break every save (POST/PATCH/PUT/DELETE) returns 423 "Lunch break…", except `/api/attendance`, sign-in/out, and Administrators. Reading pages is not blocked. Test covers the hours, the allowed APIs and the server refusing an Entry Clerk's save but not a clock-in, a read or an Administrator's save. All 274 tests and build pass. No migration.
- **In progress:** none.
- **To do (owner):** deploy, then check it at 12:00 PM.

### Members: delete a deactivated account entered by mistake; Deactivated filter (2026-10-28)

- **Owner:** PH-24581942's D-190 account is empty and was a mistake, but could not be removed (only deactivated); only a deactivated account may be deleted, with a reason; add it to the filters.
- **Done:** permanent delete has a new kind `account` (`lib/admin-delete.ts`): the account, its collections, transfer records and its New Sale in that program if any; the member stays; refused unless the account is Deactivated; reason and DELETE required; Audit Log and Record Corrections keep it. Members: **Delete account** button (Administrators) on a deactivated account's row; new **Deactivated** standing filter with its count (`lib/member-directory.ts`, `lib/member-directory-data.ts`). Tests added; all 273 pass; build passes. Production plan for ENR-LEG-3D23AA5F06 (read only): 1 account, 1 transfer record, the member stays, no blockers.
- **In progress:** none.
- **To do (owner):** deploy; Members → Deactivated → PH-24581942 → D-190 → Delete account, with the reason.

### Member Corrections: moving a receipt with a corrected amount (2026-10-28)

- **Owner:** PH-24581942's OR 1654 S could not move to its D-180 account because of the amount paid; moving should also allow adjusting the amount.
- **Done:** Move receipts takes an optional corrected amount per ticked receipt (`MoveInput.amounts`, `lib/member-corrections.ts`; form column **Corrected amount** in `/member-corrections`). The receipt is counted from the new amount at the target's pay (`receiptMonthsIn`, `lib/entry-edit.ts`), `amount_collected` is saved, incentives are recalculated (`repriceCollections`), and the note and Record Corrections keep old → new. Refused for a receipt not ticked, an invalid amount, or a receipt on a remittance slip in progress. New test; all 272 tests and the build pass.
- **Production preview (rolled back):** 1654 S (May 25, 2026) ₱190 → ₱180 joins D-180 ENR-LEG-69F09BA2DC as NOP 72 (2025-12); 2536 S, 2751 S, 4006 S move one month on (to NOP 76, 2026-04); D-180 Forfeited → 150D; D-190 ENR-LEG-3D23AA5F06 is left with no receipts (Forfeited).
- **In progress:** none.
- **To do (owner):** deploy; in Member Corrections move 1654 S to D-180 with corrected amount 180; then delete the empty D-190 account from Members if it should not exist.

### MAM printout redesigned (2026-10-28)

- **Owner:** redesign the MAM printing (design approved; add the last date of payment; A4 landscape).
- **Done:** new print-only `components/mam-print.tsx` (styles `.mam-print*` and `@page mam` in `app/globals.css`); the screen view is hidden when printing and unchanged otherwise; the old one-line print rules were removed. Layout as described in `docs/mam-implementation.md`: one MAS per page, header, summary, # / Member / DOI / Rate / Last payment / months (3 lines each, * = Waiver), totals, key, signature lines, page numbers. Checked with a sample render printed to PDF (A4 landscape pages). Type check, lint, all 271 tests and build pass.
- **In progress:** none.
- **To do (owner):** deploy, then print one branch from MAM and say what to adjust (the signature titles and one MAS per page were kept as proposed).

### Old-site member 305 added without receipts (2026-10-28)

- **Owner:** find Joydeline Liray (old site); put her in the system, receipts to be added later in Member Corrections.
- **Done on production:** the October 8 import had left out old-site New Sale 305 (one of its OR numbers, 19671 C, is already on another member's account: COL-LEG-673CB31A39, PH-11543714, a ₱320 receipt of the same day). `migrate-legacy-site.mjs` was run on a copy of the export holding only member 305 and its New Sale, no collections: MEM-WEB-305 (PH-79493029), account ENR-WEB-305, DS-430 (DP-0055), DOI May 26, 2026, CALINAN, MAS Puya, Jiramay; status NS.
- **In progress:** none.
- **To do (owner):** add her receipts in Member Corrections → Insert missing receipt: old-site collections 385 (OR 18502, Jun 22, ₱430, recorded Jun–Jul but one month: June), 599 (19671 C, Jul 27, decide whether it is hers), 864 (21742 C, Aug 28), 1271 (24058 C, Sep 29). Without them the account counts from the DOI and needs a Waiver; it would be Forfeited from Nov 27.

### Status clock: a month is missed the day after its due day (2026-10-28)

- **Owner:** before it becomes 60D it should be the next day: last payment on the 10th, 60D on the 11th.
- **Done:** `accountState` (`lib/account-rules.ts`): each month after Month of falls due on the OR date's day and is missed the day after, so U → 60D (and the Waiver), 90D, 120D and 150D each start one day later; Forfeited was already the day after (unchanged). Paid October 10 for July: 60D/Waiver September 11, 90D October 11, 150D December 11, Forfeited January 11. A payment made on the due day itself needs no Waiver. Short months: paid January 31, February due February 28 and missed March 1, 60D April 1. Tests updated (`scripts/test-account-rules.mjs`, `scripts/test-money-rules.mjs`); all 271 pass; build passes.
- **Impact (production preview, read only, October 28):** it only differs from the old rule on the due day itself, so at any moment it moves just the accounts whose day is today one step down (about 135 on October 28: 60D → U 67, 90D → 60D 27, 120D → 90D 27, 150D → 120D 14). Nobody becomes Forfeited because of it. The preview's other rows (Fully Paid → …, a few Forfeited → …) come from the preview script not reading full payments or old-system forfeits, not from this change.
- **In progress:** none.
- **To do (owner):** deploy. No migration.

### Corrections: an Administrator confirms an OR number without a letter (2026-10-28)

- **Owner:** in corrections, the admin can tick a box that the OR number really has no letter.
- **Done:** `orNumberProblem(value, { noLetter })` (`lib/or-number.ts`) accepts digits only when confirmed. The tick (`orNoLetter`) is taken by Member Corrections → Insert missing receipt (`insertReceipt`), Edit / Corrections (`saveEntryEdit`, collections) and the quick correction (`correctSaleOrCollection`: Edit / Corrections, Today's Entries, Exceptions, Entry History). Every route passes it through `orNoLetterConfirmed` (`lib/or-no-letter.ts`): true only for an Administrator (`canConfirmOrWithoutLetterFor`: manage-users or the Administrator role), refused for anyone else (IT included). The correction's Record Corrections entry says "OR number confirmed by an Administrator to have no letter". Forms: `components/or-no-letter-check.tsx`, shown only to Administrators while the OR typed is digits only (Entry History's form, which cannot tell, shows it for collections). New Collections entry is unchanged: the letter is still required there. Test added (Admin accepted, IT refused, quick correction); 271 tests and the build pass. No migration.
- **To do (owner):** deploy; then DAVNOR-COLL row 9280 (MEM-LEG-2B6625A761, PH-09857141, OR 0048) can be added in Member Corrections → Insert missing receipt with the box ticked.

### Member Corrections: moving a receipt into the middle of an account (2026-10-28)

- **Owner:** PH-10130825: OR 17286N cannot be moved to its D-210 HG account: "D-210 HG account ENR-LEG-F2223AC7D4: Account ENR-LEG-F2223AC7D4 has gaps in payment coverage. Review its history. Nothing was saved."
- **Found (production, read only):** 17286N (Feb 12, ₱210) is on the member's 190 account as NOP 29 (2026-03), the only ₱210 receipt there; the D-210 HG account has January (NOP 26) and then March onward, no February.
- **Cause:** `moveReceipts` (`lib/member-corrections.ts`) checked the target's new history with the moved receipts still carrying their old account, and the check (`accountState`) counts only the account's own receipts, so the moved receipt was left out and its month showed as a gap. Any move into the middle of a history failed this way; a move to the end or to an empty account worked. Also, the target's numbering started from the lowest NOP of all its receipts, the moved ones included, whose NOP and month are the other account's numbering.
- **Done:** the moved receipts are the target's in the check; an account with receipts keeps its own first NOP and month (a moved receipt sets the start only for an account with none). Production preview of this move: 17286N → D-210 HG NOP 27 (2026-02), the next 8 D-210 HG receipts one month on (October 15's to NOP 35, 2026-10), the 190 account's later 7 receipts one month back to close its gap; both stay U. Test added (fails before the fix); 270 tests and the build pass. No migration.
- **To do (owner):** deploy, then move 17286N again in Member Corrections.

### Old sheet rows still missing, added through Member Corrections (2026-10-28)

- **Owner:** some data in `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx` is still not in the database; import it using the member corrections.
- **Production dry run** (`migrate-legacy-members.mjs … --source-title=Data-Base-Old --fix-nop-typos --repair`): 3 members, 3 accounts, 3 New Sales, 6 collections fit as they are; 26 new collections held back (a gap or overlap with the account's history); 12 accounts with payments that are not whole months, 8 D-290 (500) payments without a DOI and 13 rows with an unknown branch, as on October 10 (`backups/legacy-migration-report-*.txt`).
- **Fixed in the importer:** an account already in the database now keeps the member it belongs to now. Before, when that member had been merged away since (merge-name-variants, Member Corrections), the import would have created the old member again as an empty copy (17 on production) and pointed the account's new payments at it.
- **Done:** the import writes the held receipts to `backups/legacy-held-new-<stamp>.json` (account, OR, dates, amount, months; no names). New `scripts/insert-held-legacy-receipts.mts <file> [--apply]` adds each through Member Corrections' **Insert missing receipt** (`insertReceipt`): Posted and Remitted with no slip, placed by OR date among the account's receipts (numbered again), incentive and share at its NOPs, status stored again, the sheet row and problem as the reason in Record Corrections. Preview rolls back; saving goes in OR-date order per account.
- **Production preview:** 24 of 26 can be inserted (1 existing receipt renumbered; e.g. statuses 90D → 60D, 120D → U where the missing months were the old-sheet receipts). ENR-LEG-49FC9CEF61 has two held receipts, two different ORs: NOP 36 and 37 once saved. Refused: DAVNOR-COLL row 9280 (OR 0048 has no branch letter) and row 9466 (OR 0373P is already on COL-LEG-D0D22A9063).
- **Applied on production (owner: run it, October 28):** the import wrote 3 members, 3 accounts, 3 New Sales and 6 collections (4 flagged duplicate numbers); Member Corrections inserted 24 of the 26 held receipts (1 existing receipt renumbered; ENR-LEG-49FC9CEF61 got NOP 36 and 37). The importer now also lists every row it cannot import by ID (`backups/legacy-left-out-<stamp>.json`; the held list carries the collection and member IDs too). A dry run after: nothing else to write.
- **Left for the owner (5 rows):** DAVNOR-COLL row 9466, MEM-LEG-605B5A97E2 (PH-34220860), COL-LEG-FF976EFEF9: OR 0373P is already on COL-LEG-D0D22A9063, another member's account (MEM-LEG-DC6597CBCA, PH-44991262), so one OR is wrong. DAVNOR-COLL row 9280, MEM-LEG-2B6625A761 (PH-09857141), COL-LEG-895EEB681F: OR 0048 has no branch letter. DAVNOR-COLL row 9390, MEM-LEG-DED34AFFF6 (PH-10130825), COL-LEG-C2A9B95163 and row 9455, MEM-LEG-F0337F7390 (PH-28024475), COL-LEG-F109984CFA: not a whole number of monthly payments. M3-COLL row 17231, COL-LEG-EC59C79995: D-290 (500) payment of a payer not linked to any member (no member ID; no D-290/DSP-290 New Sale or dated payment). The other leave-outs of earlier runs are in the database by now. Each can be added in Member Corrections → Insert missing receipt once decided.

### Entry Clerks see their audit; an approved report is locked (2026-10-27)

- **Owner:** an Entry Clerk cannot tell whether their report is already approved in the audit, or whether it has findings. Once approved, the report must not be edited again unless an Administrator allows it for that specific report.
- **Done:** the clerk's own report (Reports, every tab) shows **Audit:** Not audited yet / Being audited / Approved · Balanced / Approved · With findings, who approved it and when, and the findings (amber box) once approved; a draft's findings are not shown, as they are not final. While the report is approved, it is **locked for the clerk**: Edit / Delete / Void and the record panel (expense, cash to bank, Fidelity, Cash Beg, notes) are hidden, and the server refuses those saves (`reportLockProblem` in `lib/daily-audit.ts`, checked first in `POST /api/clerk-report`). The day an action falls on is checked against the clerk's approved audit of that day and of the week, month and year containing it: an expense on the day it is recorded (a new one today), a deposit or Fidelity slip on its date (old and new date when edited), notes and Cash Beg on their own period (week notes against the week, month and year). On **Audits**, an approved audit shows whether the clerk's report is locked; an Administrator can **Allow the clerk to edit** (reason required) and **Lock the report again**. The audit stays Approved with the figures it was approved on (reopen and approve again to refresh them); approving or reopening ends an allowance. Migration `0031_clerk_edit_allowed` (`clerk_edit_allowed_by_name`, `clerk_edit_allowed_at`, `clerk_edit_reason` on the four audit tables); `check-database.mjs` checks it. Test added to the daily audit test; 269 tests and the build pass.
- **Not locked:** New Sales and Collections themselves (they go on the report of the day they are encoded, so a new entry never lands on an approved past day), and Finance's own Expenses pages.
- **To do (owner), in order:** `npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs` (0031 present), then deploy.

### Same-person check matches similar first names (2026-10-27)

- **Owner:** the Entry Clerk confirmed PH-91674008 and PH-53477804 are the same person, but New Sales still created a new record.
- **Found (read-only `scripts/inspect-same-person.mjs`, production):** same surname, **different first name** (old-sheet record PH-53477804, D-210 HG, Toril; new PH-91674008, DS-320, Baliok, saved Oct 26 by BARRIENTOS, RUTCHELYN in New Sales). The check looked only for the exact surname and first name, so no pop-up appeared and the sale registered a new member.
- **Done:** `findSameNameMembers` (`lib/member-records.ts`) takes the same surname and a similar first name (`similarFirstNames`: same first word, "Ma." = "Maria", one name the start of the other when at least two letters longer, so Juan/Juana stay apart, or its initial, or a word in common), exact names first; the pop-up says "the same surname and a similar first name". Middle initial and birthdate still rule a member out when both differ. Test added; 269 tests and the build pass. No migration.
- **To do (owner):** merge the two records in Member Corrections → Merge members, keeping PH-53477804 and picking the right first name.

### One date format everywhere (2026-10-27)

- **Owner:** arrange all dates in the system to be uniform to avoid confusion. Chosen: **Oct 27, 2026** (time: Oct 27, 2026 3:05 PM; month: Oct 2026); CSV/Excel downloads keep 2026-10-27.
- **Found:** raw stored dates (2026-10-27) in most tables, "Oct 4, 3:00 PM" without a year, "October 27, 2026", "10/27/2026" on the clerk report, "Tuesday, October 27, 2026", each screen with its own formatter.
- **Done:** `lib/date-format.ts` (no imports; plain dates, stored UTC times shown on their Manila day and time, Manila "YYYY-MM-DD HH:MM", months, ranges; anything else passes through, so "—" and labels stay). About 45 screens and components now use it: their own helpers (longDate, when, stamp…) call it, and dates printed raw (DOI, OR date, birthdate, leave dates, pay dates, expense/cash/Fidelity dates, remitted dates, notices) are wrapped; date inputs, keys and CSV values were left as stored. Server text too: deadlines (`formatDeadline`), entry date warnings, deposit-day messages, Exceptions, Member Corrections notes, payslip, delete titles, attendance notes, the clerk report's day labels. Tests: `scripts/test-date-format.mjs` (in `npm test`), three expectations updated. 268 tests and the build pass. No migration. **Follow-up (owner: the birthdate in viewing still not changed):** the member view lists details as label/value pairs, which the sweep missed: Birthdate now formatted there, in Member Corrections ("born …", and the merge table), and every date in the entry details panel (application date, DOI, OR date, date remitted, recorded on, encoded at; built in `lib/todays-entries.ts`) and the dashboard's recent activity.

### Member Corrections: move receipts anywhere, choose what a merge keeps (2026-10-27)

- **Owner:** Move receipts did not work when the member has one program; Merge members only offered "use the duplicate's name", nothing else to choose.
- **Done:** `moveReceipts` (`lib/member-corrections.ts`) takes a new account in another program (`newProgramId`, `newDoi`; created like the source account, numbered from its own start) or another member's account (the receipts' member is changed); the "same member only" refusal is gone. `mergeMembers` takes `fields` (per detail "keep" or "other"; `MERGE_FIELDS`: name parts, birthdate, birthplace, sex, civil status, contact, address, claimant); a chosen birthdate allows merging different birthdates; `getMemberForCorrection` returns `details`; GET `?programs=1` lists active programs. Page: Move has three destinations (this member's account, new account in another program, another member's account); Merge has "Member number that stays" and a side-by-side table to pick each value. Test added; 265 tests and the build pass. No migration.

### Fully Paid status and certificates (2026-10-27)

- **Owner:** the old "DSRDPI - FULLY PAID MEMBERS (Responses)" form lists fully paid members and their certificates; add it, and members get a new status "Fully Paid". Decisions: per account; "Paid" was not visible anywhere; Fully Paid takes no more collections; certificates Pending/Released with release date and who received it; certificate numbers automatic per branch area following the old pattern.
- **Found:** 89 rows (Sep 2024–Oct 2026), names only (no PH numbers), program, total (= rate × term), date, certificate (AREA+YEAR-seq: DAVAO, DAVNOR, DDO, SDS; per area and year; DAVNOR2026-014 and -015 were given twice), Released 84 / not 4 / Pending 1. Production (`scripts/check-fully-paid.mjs`): 31 rows match one account, 23 no member, 2 member without that program's account, 33 program labels unknown (D-460 (Old) 25, D-210 4, D-250, D-270, D-420 (4Y), D-260). Matched accounts were short in the system (old receipts not imported), some 60D–Forfeited. The old "Paid" rule added only collections, so term programs (Pay Balance Total set on production for these) never became Paid.
- **Done:** migration `0030_fully_paid` (member_programs: fully_paid_on, total, source, recorded_by, certificate_number unique, certificate_status, released_on, released_by; branches.certificate_prefix seeded from the certificates and territories; stored "Paid" → "Fully Paid"). `accountState`: Fully Paid by term months, by amount received (New Sale credit), or by a recorded date; no dues, no clock; `validatePayment` refuses payments. `lib/full-payments.ts`: numbering (advisory lock per area and year), record, auto-record when receipts complete a program (collection saves, nightly status step), release/pending, remove, list, prefixes. Page `/fully-paid` (Admin, IT, Finance; nav: Master Data / Directory / Monitoring) and `/api/fully-paid`. "Fully Paid" in the MAM, Members and SOA status lists. `scripts/import-fully-paid.mjs` (dry run / --apply): records matched rows with the form's certificates (Released or Pending), replaces unreleased automatic records, lists the rest, and previews other accounts the receipts complete. `config/fully-paid-programs.json` for unknown labels. `check-database.mjs` checks 0030. Tests: rules (term, recorded date, payment refused, flexible New Sale credit) and the page flow (numbering after 038, duplicate refused, prefix required, release/pending/remove, nightly auto-record). 263 tests and the build pass.
- **Owner (same day):** production migrated (31 of 31, 0030 present). Labels: D-460 (Old) → DP-0023, D-210 → DP-0005, D-250 → DP-0016, D-270 → DP-0015, D-420 (4Y) → DP-0018, D-260 → DP-0028 (`config/fully-paid-programs.json`).
- **Import dry runs:** 54 rows match one account; two rows (12, 65) match the same account and are left out for the owner; 31 rows have no member or no account in that program. Owner: a number the form gave twice (DAVNOR2026-014, -015) stays with the first certificate (earliest form date: Tagum rows 66, 75) and the later ones (Maco rows 79, 86) get new numbers. Every number in the form is reserved (System Setting `certificate_reserved`), so automatic numbering, in the import and in the app, never repeats a paper certificate (the dry run had given DAVAO2026-038, row 88's, which is not in the system yet); a left-out row can still be recorded with its own number. Test added.
- **To do (owner), in order:** `import-fully-paid.mjs` dry run, review, `--apply`; then deploy (the nightly job then numbers accounts the receipts complete); decide the 23 rows with no member and 2 without the account (names can be listed for that decision).

### Company Reports check: branch collections vs clerk reports; bank deposits (2026-10-27)

- **Owner:** Company Reports does not seem to read correctly; branch collections do not match the clerks' reports; check it and the other readings.
- **Checked:** every column the report reads is the right one (positions verified against the database). New read-only `scripts/check-company-report.mjs <from> <to> [branch]` rebuilds the report from the database with the same rules, lists what can make it look wrong, and compares each branch's collections with the clerk reports. October production: gross ₱1,832,625 (New Sales ₱221,280, Collections ₱1,611,345), 1,287 collections and 134 New Sales never priced (old-sheet data, incentive counted 0), 28 possible old-sheet duplicates, Bank deposits ₱0.
- **Why branches differ from clerk reports:** Company Reports put a collection on its OR date and include old-sheet imports (no encoder); clerk reports put it on the day it was encoded and only what a clerk encoded. The check splits each branch's difference into those parts.
- **Fixed:** Bank deposits read only Cash Transactions, where clerk deposits never go, so the report showed ₱0; it now adds the clerks' Bank deposits (not voided) by deposit date and branch. Test updated. 260 tests and the build pass. No migration.
- **Production check (Oct 1–31):** every branch's gap is the old-sheet imports (e.g. Calinan ₱71,365, Mintal ₱63,850); the date basis explains only ₱510 (Mintal). Bank deposits now ₱577,542.02. So no "Count by date encoded"; instead (owner: okay) a **Show** choice on Company Reports: **All entries** (default) or **Encoded in the system only** (leaves out entries with no encoder, the old-sheet imports), so branch collections match the clerk reports; `/api/reports?source=encoded`, `encodedOnly` in `buildOperationalReport`. Test added; 261 tests and the build pass. From November the imports are gone, so both views agree.
- **In progress:** none.

### Upgrade #10: space on Supabase Pro; Fix on every System Health finding (2026-10-26)

- **Owner:** #10, "but we have pro subscription in the supabase"; then, while it was being built: a Fix button on each item of Schema, Access & Data Integrity that goes directly to where it is fixed.
- **Done (#10):** new `lib/capacity.ts`: Pro allowances (8 GB database, 100 GB Storage; `SUPABASE_DATABASE_GB` / `SUPABASE_STORAGE_GB` override), `measureCapacity` (database size, receipt-photo Storage size and file count from `storage.objects`, photos still inside the database), `recordCapacity` (one point a day in System Setting `capacity_history`, about 13 months), `growth` (per 30 days from the oldest point 7–30 days back, months left). Nightly Jobs got step 4 **Database size**. System Health: the size tile reads against Pro (was "of 500 MB (Supabase Free)"); new **Space & Growth** panel (database, Storage, photos still in the database with the move-photos command, growth and months left once a week is measured). Test: one point per day, photos in the database counted, growth and months left, under a week unknown, shrinking gives no date.
- **Done (Fix):** each integrity item carries its own link (`IntegrityItem { text, href }`): account findings open `/user-accounts?employee=<ID>` (User Accounts now opens that person's account editor, or the create panel when there is none); an unlinked MAS name opens `/employees?search=<surname>` (Employees now reads `?search=`); a branch name opens Branches; command fixes (missing tables/columns, migrations) have no button. The group link is now **Open page**.
- All 260 tests and the build pass. No migration.
- **To do (owner):** deploy (after migrating 0029); in System Health → Nightly Jobs press **Run now** once so the first size is recorded; optionally move old photos to Storage if Space & Growth shows many in the database.
- **Upgrade list complete:** #1–#10 built.

### Upgrade #9: money-rule tests (2026-10-26)

- **Owner:** start #9.
- **Done:** new `scripts/test-money-rules.mjs` (in `npm test`): every centavo accounted for (company share + incentives = amount collected) across 1,000+ combinations of rate, mark-up, percentage/fixed tier, role (MAS, Collector, DTO), NOP range and excess, with the mark-up always remitted and no negative or oversized incentive; percentage rounding; ORC half rounded down (odd centavo to the company); reactivation 10% after mark-up; flexible payments split to the centavo across months (calculation and account history agree); whole-month crediting and overlaps; New Sale incentive (fixed capped at the amount paid, below one month earns nothing); No incentive / forfeited amounts; short months (paid on the 31st: missed February 28, 60D March 31, Forfeited August 1); the ₱10,000 Fidelity lock. The Fidelity split moved into pure `lib/fidelity-cap.ts` (`fidelityStanding`; `lib/fidelity.ts` uses it, same results). In the main harness: the incentive deadline to the minute (3:00 PM keeps, 3:01 forfeits), a Sunday OR, company-wide holidays in a row, the new year, an unreadable OR date. Already covered before and left as is: basic tiers, branch tiers, ORC/DTO, the grace day, slips following edited entries. Every new test passed against the current code, so no money rule was found wrong. 259 tests and the build pass. No migration.
- **In progress:** none. **To do:** #10 Supabase 500 MB limit (next).

### Old-sheet receipts move to a program without tiers (2026-10-26)

- **Owner:** PH-10212782 must move from 210 to D-250 FG (a mistake in the old sheets), but the move said "Cannot recalculate incentives for COL-LEG-12D9FD27F5: Configure exactly one MAS incentive tier for NOP 12."
- **Found:** D-250 FG (DP-0016) has tiers only for NOP 13–120 (MAS 15%, Collector 10%, NABUNTURAN Collector 12%); nothing covers NOP 1–12, so a moved receipt at NOP 12 cannot be priced, and every move stopped. 15 old D-250 FG receipts at NOP 11–15 were never priced for the same reason.
- **Done:** `repriceCollections` / `repriceSales` (`lib/entry-edit.ts`): a receipt that was never priced (old-sheet data: no company share and no breakdown saved; a sale with no company share) no longer stops a move when the new program has no tier for its NOP; it moves and stays unpriced, and the move's message lists it (the message existed, the list was never filled). A receipt that was priced still stops the move, so no stale incentive is kept. Tests: the never-priced case; the transfer test's receipts now carry a saved share so the block is still tested. All 248 tests and the build pass. No migration.
- **To do (owner):** deploy, move PH-10212782 again; decide what D-250 FG pays for NOP 1–12 and add the tiers (all branches) if it should pay anything.

### Corrected account stayed Forfeited (2026-10-26)

- **Owner:** PH-73684484 was corrected but still shows Forfeited; find the bug and fix it.
- **Found (read-only `scripts/inspect-account-status.mjs`, production):** account ENR-LEG-6CB3032F54 (D-180): MORADA, REBECCA's save on Oct 23 set U; the nightly job on Oct 25 00:05 stored Forfeited (its receipts still covered Dec 2024–Aug 2025, 14 months behind under the Month-of rule); the months were then corrected to Jan–Sep 2026, which gives **U** (paid through Sep 26). It stayed Forfeited because `accountState` held any stored Forfeited, and every recalculation passes the stored status in, so a Forfeited the app stored itself could never be undone. Production: 600 accounts stored Forfeited, 6 of them only because of the hold (1 set by the nightly job, 5 not in the Audit Log, i.e. carried from the old system).
- **Done:** migration `0029_forfeit_held` adds `member_programs.forfeit_held` and sets it on accounts stored Forfeited that the app never set Forfeited itself (no Audit Log change to Forfeited); not logged as edits. `accountState` holds Forfeited only when `forfeitHeld` (still not on Pay the Balance programs); `loadAccountData` reads it; MAM past months ignore it; Member Corrections history fixes decide from the receipts and clear it. Hidden from the Sheets layer. `check-database.mjs` checks 0029. Tests: a stored Forfeited the app worked out follows corrected receipts; an old-system one holds. All 247 tests and the build pass.
- **To do (owner):** migrate production before deploying (`npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs`), and staging (`npm run db:migrate`); deploy; then System Health → Nightly Jobs → Run now (or wait for tonight) so PH-73684484 and the other reopened account are stored with their worked-out status; confirm with `inspect-account-status.mjs PH-73684484`.

### Maintenance notice for everyone (2026-10-26)

- **Owner:** a button for IT that shows every user a notice like the Notice to Explain one, "Your cute IT is doing...", so slowness, bugs or errors during an update or database adjustment are expected.
- **Done:** System Health → **Maintenance Notice** panel (IT and administrators): message (default "Your cute IT is updating the system right now..."), Turn on for everyone, Update notice, Turn off; shows who turned it on and when. Stored as one System Setting (`maintenance_notice`, `lib/maintenance-notice.ts`); route `/api/maintenance-notice` (GET any signed-in user, POST IT/admin). Delivered with the sidebar numbers (`/api/notifications`), so it reaches every open page within seconds via live updates on `system_settings`, and on each page change or 2-minute refresh otherwise; shown in a blue box at the top of every page (`components/app-shell.tsx`). Test: an Entry Clerk cannot change it; IT turns it on (blank message uses the default), every user receives it, IT turns it off. All 246 tests and the build pass. No migration.
- **In progress:** none. **To do:** owner applies the relinks (merge-employees.mjs dry run, then --apply); #9 money-rule tests next.

### Upgrade #8: people picked by Employee ID (2026-10-24)

- **Owner:** #8.
- **Checked first (read-only `scripts/check-name-links.mjs`, production):** renames already follow everywhere (migration 0012) and every record has its branch link. One shared full name: Racho, Kristine (LEG-2026-0022 active, SDS-2026-0006 inactive; 72 sales, 13 collections, 62 accounts linked between them). MAS names with no link: sales 11, collections 135, remittances 53, accounts 28, deposits 67; mostly not people (DTO, Others, ALL MAS) or short names (Capacite, C.).
- **Done:** new `lib/person-scope.ts` (`masScope`, `accountableScope`): by Employee ID, and by name (capitals and extra spaces ignored) only for a record with no link. Used by the MAS and Collector dashboards (month report, today's entries, recent activity, and the portfolio, now read by ID instead of all 14,000 accounts), `buildOperationalReport` (`personId`, and `encoderIds` for Report Review's Entry Clerks instead of their names) and Today's Entries. Test: two employees with one name and an old unlinked record (each gets only their own, both keep the old one). All 245 tests and the build pass. No migration.
- **Still by name:** the Company Reports person/encoder filters picked from its lists, and reviewers' remarks on a clerk's report. Branch matching by name is safe (unique names, all linked).
- **Owner confirmed (2026-10-26):** Kristine Racho LEG-2026-0022 and SDS-2026-0006 are one person; "Capacite, C." is MD-2026-0035. `config/employee-merges.json` relink gets "Capacite, C." → MD-2026-0035 (records left unlinked by the October 8 merge of LEG-2026-0025); applied with `scripts/merge-employees.mjs`. Racho is merged with `scripts/merge-employee-pair.mjs --duplicate LEG-2026-0022 --keep SDS-2026-0006`, which now prints both records' status and sign-in before any change. First --apply stopped safely on a different attendance record on 2026-10-07 (nothing changed); the script now lets a system absence give way to a real record, lists every other clash, and has `--attendance-from duplicate|keep` and `--activate`. Owner (2026-10-26): remove LEG-2026-0022 and activate SDS-2026-0006; run with `--attendance-from duplicate --activate` (LEG-2026-0022 was the ID in use). Dry run (2026-10-26): 62 accounts, 16 sales, 12 collections, 15 attendance days moved; one clash (2026-10-09, notes only). "Racho, K." (2 unlinked sales and 2 accounts) added to the relink list as SDS-2026-0006; merge-employees.mjs runs after the pair merge, so the name has one employee. Then --apply on production by the owner. More relinks confirmed the same day: Ambasing, C. → MD-2026-0002, BALAIS, MARICEL PANARES → LEG-2026-0013, Malazarte → LEG-2026-0058, Degamo, N. → MD-2026-0018 (Baclayon, J. → MD-2026-0083, confirmed later that day). **Found in the production dry run:** "Degamo, N." changed 822 collections' collector (accountable) name: old collections name a collector with no link, and the first `accountableScope` gave such a collection to its MAS. Fixed: a collection belongs to its linked collector, else its collector name when that differs from the MAS, else the MAS (test added). `merge-employees.mjs` relinks now set the link column too, and it links every collection whose collector name is exactly one employee's (staging dry run: 22,959); `check-name-links.mjs` counts collector names without a link. **Production (2026-10-26):** relinks applied (no shared names left). 20,514 old collections still had a short-form collector name ("Arot, F.", "MA. DE CORAZON B. CAPACITE") with no link; every one of the top 40 appears only on collections of one linked MAS with that surname (100%). New `merge-employees.mjs --collectors`: links such a name to that MAS (name and ID) when all its collections share one linked MAS with the same surname; lists every pair and every name left for review; owner approves the dry run before --apply. Dry run: 20,438 collections linked to their own MAS (67 names); left for review and then confirmed by the owner: Oñs, M. → DNDO-2026-0012, Calumbay, C. → LEG-2026-0002, Baclayon, J. → MD-2026-0083 (relink list).
- **In progress:** none. **To do:** #9 money-rule tests (next), #10 Supabase 500 MB limit.

### Entry Clerk report saves show their result (2026-10-24)

- **Owner:** all saving on the Entry Clerk report did nothing and the typed text was gone.
- **Checked:** the server saves work (notes, Cash Beg, deposit and expense through the route, then the report reloads with them; reproduced in the test database). The page's save sent the request and read the reply as JSON with no error handling, and showed the result only at the top of the page, out of view of the form.
- **Done:** `components/clerk-report.tsx`: a save that fails for any reason (time-out, photos too large, expired sign-in, no connection, a refusal such as Day Off) shows the reason under the form in red; a save shows in green; Save is disabled while saving. New read-only `scripts/check-clerk-report-saves.mjs`: per employee, the notes, Cash Beg, deposits, expenses and Fidelity slips saved in the last 3 Manila days, and who is marked Day Off today.
- **Cause (production check, same day):** the saves were working (nine clerks saved notes, Cash Beg, deposits and expenses through the day). After a successful save the form clears for the next entry and the message showed only at the top of the page, so it looked as if nothing was saved; clerks clicked Save again. The check script also lists possible repeated expenses (same clerk, day, amount, receipt no. and expense date) to void.
- **Production result:** no repeated expenses; saves kept arriving during the check (a clerk's notes at 4:45 PM).
- **In progress:** none. **To do:** deploy; then #8 joins by ID.
- **To do:** #8 joins by ID (after this).

### Upgrade #7: one time zone, Manila, for every date (2026-10-24)

- **Owner:** start #7.
- **Done:** new `lib/manila-date.ts` (`manilaDateOf`, `manilaToday`, safe in the browser too) reads both UTC ISO times and database times (`2026-09-30 16:30:00+00`) and gives the Manila date; `manilaDateOf` in `lib/remittance-deadline.ts` and the dashboard's own copy now use it. Fixed places that cut a UTC time to its first 10 characters: the **Company report** New Sales lines (a sale saved before 8:00 AM Manila fell on the day before), the **Statement of Account** New Sale date fallback, the HR dashboard **Filed** date, payroll program deduction **Paid/Linked** dates, the Members **transfer/deactivation** dates, and the **birthdate** limit (server and form). Checked and already Manila: clerk reports (encoded times come in Manila), Today's Entries, Gross Sales, executive analytics, remittance deadlines, day-off and entry search. Plain date columns are unchanged. No migration. Tests: `scripts/test-manila-date.mjs` (added to `npm test`) and a Company report test with a sale at 12:30 AM Manila; all 244 tests and the build pass.
- **In progress:** none.
- **To do:** #8 joins by ID instead of names (next), #9 money-rule tests, #10 Supabase 500 MB limit.

### Upgrade #6 finished: every save by ID (2026-10-24)

- **Owner:** finish #6 completely before #7.
- **Done:** the last writers left the Sheets-style layer. **Remittances** (`lib/remittance-workflow.ts`): creating a slip writes the slip, its links and each entry's status and forfeit (one update per entry) in one transaction; approve/reject lock the slip and re-check it is pending (two approvers at once: one is refused, tested), with the entries' status and any incentive given back in the same transaction; Fidelity slips edited/voided on the locked slip; resubmit reopens only entries still Returned; the ledger reads slips and links from the database. **Attendance** (`lib/attendance-data.ts`) reads and writes the attendance table; updates go by record ID (the "rowNumber" callers see is now only a found marker); bulk marks and reverts are one transaction; reverting today's mark deletes only a mark with no clock-in. **Leave**: review only while Pending, saved with its attendance days. **User accounts**: create (with roles, user ID under a lock), edit roles, reset/change password, delete, all by ID; Employee ID change is database-only (the account follows by its link). **Quick corrections** lock the entry. **Company targets** upserted, **record corrections** and **Fidelity payouts** inserted directly. Tests: the harness now loads roles, slips, links and attendance into the test database; about 30 tests moved from cell-write checks to database checks; new test for two approvers at once. All 240 tests and the build pass. No migration. Stored data keeps its format (JSON fields were already objects; the old layer stripped the leading apostrophe from dates and times).
- **Behaviour now visible in tests:** a cash New Sale or Collection batch is sent for approval right after it is saved (it always was; the old test mock simply dropped that write).
- **In progress:** none. Only reads still use the Sheets-style layer.
- **To do (owner):** deploy; watch Remittances, attendance and user accounts after the deploy.

### Audits, calendar, settings, roles and remarks save by ID (2026-10-24, upgrade #6 phase 4)

- **Owner:** continue upgrade #6 with phase 4.
- **Done:** period audits (`lib/daily-audit.ts`) read and write daily/weekly/monthly/yearly audit tables by ID; a save takes a lock on the clerk and period (one audit even when saved twice at once), approve/reopen lock the audit and update it once; figures saved as JSON text by the old code are still read. Holidays (`lib/attendance-calendar.ts`) saved and deleted by ID; adding the Philippine holidays twice at once adds them once. Declaring a non-working day writes the closure and cancels clock-ins in one transaction; removing it deletes only that closure by ID. System settings (`lib/system-settings.ts`) one row per key, upserted. Roles (`lib/roles.ts`) created, edited and deleted by ID under a roles lock (names stay unique; a role assigned to accounts cannot be deleted). Report remarks (`lib/report-remarks.ts`) read and written directly. Employee ID change no longer rewrites Report Notes a second time through the Sheets layer. Tests moved to the database plus a new test for simultaneous saves; all 239 tests and the build pass. No migration.
- **Not moved (documented in the system guide, limit 9):** attendance records, leave requests, users and user roles (sign-in), audit history reads, record corrections. Attendance is the largest; it can be its own follow-up.
- **In progress:** none. Upgrade #6 is complete for its four phases.
- **To do (owner):** deploy.

### Finance saves by ID in one step (2026-10-24, upgrade #6 phase 3)

- **Owner:** continue upgrade #6 with phase 3.
- **Done:** `lib/finance-data.ts` (Expenses, Cash Transactions, the cash ledger, voiding) and `lib/finance-operations.ts` (cash accounts, vendor bills, commissions) rewritten on their tables, by ID. Expense edit: one update on the locked row (it was five cell writes by row position); delete and void: locked, one update. Cash transactions are inserted in the caller's transaction, so a payroll, vendor, commission or Fidelity payment and its cash outflow save together (the payroll test now proves a failed payment leaves no cash record). **Fixed:** a vendor payment checked the balance before its transaction, so two payments at once could overpay a bill; the bill is now locked first (tested). Commissions are locked while paid; cash account names stay unique under simultaneous saves. Tests moved to the database; all 238 tests and the build pass. No migration.
- **In progress:** upgrade #6 phase 4.
- **To do (owner):** deploy.

### Payroll company-program deductions: reminder list (2026-10-24)

- **Owner:** of the three options for upgrade #3's last item (create the Collection automatically, a reminder list, or leave it manual), chose the reminder list.
- **Done:** migration 0028 adds `program_id`, `collection_id` (one link per collection; set to blank if the collection is deleted), `collection_linked_at` and `collection_linked_by` to `payroll_adjustments`. New Company program deductions save their program. Payroll shows **Company program deductions waiting for a Collection** for Paid payrolls; Finance links the OR of the Collection the Entry Clerk encoded (`linkDeductionCollection` in `lib/payroll.ts`, action `linkDeduction`); it must be posted, same program, same amount, not linked elsewhere; unlink is possible. Test added; all 238 tests and the build pass.
- **In progress:** none.
- **To do (owner):** run migration 0028 on production **before** deploying (`npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs`: 48 tables, OK); deploy; then link the Collections for deductions already paid.

### Clerk report cash saves in one step (2026-10-24, upgrade #6 phase 2)

- **Owner:** continue upgrade #6 with phase 2.
- **Done:** `lib/clerk-cash.ts` rewritten on `bank_deposits` and `report_notes`, by ID. Add deposit: one transaction that locks each reference number (6+ digits) in the remarks, checks no other deposit that is not voided has it, then inserts, so two clerks saving the same reference at once cannot both succeed (the October 23 GCash case). Edit deposit: the row is locked and updated once by ID (it used to be two writes by row position). Void: one update by ID. Notes and Cash Beg: one row per clerk, period and branch, found with any capitals and updated, or inserted with the key unique, so two saves at once never make a second row; Cash Beg and notes still change only their own fields. No duplicate check on production was needed: `report_notes.note_key` was already the table's key, and no new rule or migration is added. Reports read the same data. Four tests moved to the database, with new checks for two saves at once (deposit reference and Cash Beg). All 237 tests and the build pass.
- **In progress:** upgrade #6 phase 3 (Expenses and Cash Transactions).
- **To do (owner):** deploy.
- **Also (owner, October 24):** D-420 and DC-420 have incentive tiers only from NOP 13; they are old programs with no new members, so no NOP 1-12 tiers are needed. DPB-420 gives the MAS 30% for NOP 1-6 by its setup; DPB-420 (5Y) gives 50%. `scripts/inspect-program-incentives.mjs <program> <NOP>` (read only) shows any program's tiers and how its receipts at a NOP were priced.

### Payroll saves in one transaction (2026-10-24, upgrade #6 phase 1)

- **Owner:** upgrade #6, explained and approved: start with Payroll. The risks were saves that stop half way (Mark paid wrote the cash outflow, then each commission, then the run, separately), two saves at once, and updates by row number.
- **Done:** `lib/payroll.ts` rewritten on the database tables (`pay_profiles`, `payroll_runs`, `payroll_lines`, `payroll_adjustments`, `commissions`), by ID. Create, recalculate, add/remove adjustment, approve, pay, void and delete are each one transaction that locks the run first; create and recalculate also take a payroll-wide lock, so overlapping periods and double-claimed commissions are refused even when two people act at once. Mark paid: cash outflow, commissions Paid and run Paid together; a second Mark paid says "already paid" and adds nothing. Pay profiles are saved as one row per employee (upsert). Same screens and results; settings saved by the old code are still read. Tests: the payroll test now checks the database, and a new test proves a failure part way through payment saves nothing (commission stays Pending, run stays Approved) and that paying twice gives one cash outflow. All 237 tests and the build pass. No migration.
- **In progress:** upgrade #6 phase 2 (clerk report cash) is next.
- **To do (owner):** deploy.

### Program pay locked once paid (2026-10-24)

- **Owner:** upgrade #5. Of the two options (block rate changes on programs in use, or store the rate on every receipt), the owner chose 1: block.
- **Done:** `lockedPayChange` (`lib/master-data-crud.ts`) refuses a change of Base Pay, flexible payments or registration fee required on a program that has any posted collection, on Programs → Edit and on Edit selected (one refused program saves nothing); the message names the program, what changed and how many collections, and says to create a new program for a new price. Programs with no collections yet can still change. The Base Pay hint on the program form says so. Test added; all 236 tests pass. No migration.
- **In progress:** none.
- **To do (owner):** deploy. A price change for new members is a new program (e.g. "D-350 2027").

### Member Corrections page (2026-10-24)

- **Owner:** upgrade #4, with all four tools chosen (fix coverage, move several receipts, merge two members, split a member), plus "also inserting of record" (a missing receipt).
- **Done:** `/member-corrections` (IT and Administrators; sidebar next to Edit / Corrections; Roles -> Page access "Member Corrections"). Find a member, see every account and receipt, then use Fix coverage, Move receipts, Insert missing receipt, Merge members or Split member. Each tool previews the exact result (the repair runs in a transaction that is rolled back) and saves with a required reason; incentives, slips and statuses follow; Audit Log and Record Corrections keep it (`lib/member-corrections.ts`, `app/api/member-corrections/route.ts`, `app/member-corrections/page.tsx`). `mergeAccountInto` gained an `anyMember` option for joining two people's accounts in the same program during a merge. Inserted receipts are Posted and Remitted with no slip (history repairs, not new cash). Three new tests (preview changes nothing, reason required, coverage start, insert placement and pricing, move with pay recount, split into a new member, merge with joined accounts and filled details, access); all 235 tests and the build pass. No migration.
- **In progress:** none.
- **To do (owner):** deploy, then try each tool on a known case (Preview only first). The per-case scripts in `scripts/` stay for bulk work from the old-system sheets.

### Status clock: Month of on the OR date's day (2026-10-24)

- **Owner:** the counting of Waiver, 60D and so on goes back to "Month of", with the start/end day taken from the OR date's day; Forfeited too (confirmed).
- **Done:** `accountState` (`lib/account-rules.ts`): paid through = last covered month on the last OR date's day; Waiver and 60D two missed months, 90D three, 120D four, 150D five or more; Forfeited the day after six missed months (twelve for Pay the Balance). Paid October 10 for July: 60D/Waiver September 10, 150D December 10, Forfeited January 11. Validation of new payments (Waiver on the OR date, Forfeited blocks) follows automatically. Tests updated; all 232 pass. New read-only `scripts/preview-month-of-status-rule.mjs`.
- **Impact measured on staging (October 24, 14,035 accounts), new rule against the rule it replaces:** 2,229 accounts change, almost all to a more overdue status; Waiver needed today 3,169 → 3,987; about 347 become Forfeited (Forfeited blocks payments, and a stored Forfeited stays on programs that are not Pay the Balance even if the rule changes later).
- **In progress:** none.
- **To do (owner):** before deploying, run `npm run prod -- node scripts/preview-month-of-status-rule.mjs` to see the production numbers. After deploying, statuses update on screen at once and are stored by the nightly job (or MAM → sync).

### Finance links: payouts leave the cash ledger (2026-10-24)

- **Owner:** upgrade #3: some payouts did not create cash records, so the cash ledger and reports could disagree.
- **Done:** vendor bill payments, commissions paid directly and Fidelity withdrawals/releases now each record a Cash Transaction outflow, saved in one database transaction with the payment (`cashOutDetails`, `payVendorPayable`, `payCommissionDirectly` in `lib/finance-operations.ts`; `withdrawFidelity` in `lib/fidelity.ts`). Their pages ask for the cash account (active only), the branch charged (vendor: the bill's branch; Fidelity: the employee's branch by default) and the date paid (today or earlier); the shared form is `components/cash-out-fields.tsx`. Commissions' "Mark paid" prompt became **Pay now** with that form; Fidelity's prompts became an inline payout form. Commissions paid through payroll are unchanged (the payroll outflow covers them). New test: refused payments save nothing; vendor and commission payments write the bill/commission and the outflow with the right category, branch, account and reference. All 232 tests pass. No migration.
- **In progress:** none.
- **To do (owner):** deploy. Decide how a payroll company-program deduction should reach the member account (see the question in the session); until then record that Collection separately. Earlier payouts made before this change have no cash record; enter them in Cash Transactions if the ledger should include them.

### Nightly jobs (2026-10-24)

- **Owner:** upgrade #2: account statuses and end-of-day absences only updated when someone opened a page, so dashboards could be stale.
- **Done:** Vercel Cron calls `GET /api/cron/nightly` once a night after 12:00 AM Manila (`vercel.json`, 16:05 UTC). It runs as System: (1) records system absences for finished days, (2) stores each account's current status where it changed, (3) counts the Exceptions. Each step runs even if another fails; the result is saved in System Settings (`nightly_last_run`). IT → System Health has a **Nightly Jobs** panel (last run, each step's result and time, a warning when older than a day and a half, **Run now** for IT and administrators via `POST /api/cron/nightly`) and a Deployment Configuration check for `CRON_SECRET`. The GET route is the only API reachable without a session (`proxy.ts`) and refuses unless the request carries `Bearer <CRON_SECRET>`. No database migration. Type check, lint and all 231 tests pass.
- **In progress:** none.
- **To do (owner):** in Vercel → Project → Settings → Environment Variables, add `CRON_SECRET` (a long random value, at least 16 characters) for Production, then deploy. Vercel sends it automatically with the scheduled call. After deploying, System Health → Nightly Jobs → Run now confirms it works; the next morning the panel should show a Scheduled run.

### Notes on weekly, monthly and yearly reports (2026-10-24)

- **Owner:** check that the weekly, monthly and yearly reports allow notes; fix it if not.
- **Checked:** Entry Clerk reports (Reports → Weekly, Monthly, Yearly) already have notes on every tab (Notes section: pending cash, specific remarks, pending transactions, other comments; saved per clerk, period and branch, shown in the report's remark boxes). Report Review and Audits already take reviewer remarks for every period, and period audits keep findings.
- **Done:** Company Reports (this week / month / year / chosen dates) had no notes; it now has **Notes for <dates>** below the breakdown: notes for exactly that period, with who and when, added by anyone with Company Reports access, printed with the report. Stored in the existing Report Remarks (scope `Company` or `Company · <branch>`), so no migration. Type check and lint pass.
- **In progress:** none.
- **To do (owner):** deploy with the clock-in change.

### Clock-in location check (2026-10-24)

- **Owner:** flag employees who clock in away from their branch (for example from home) without locking out MAS field staff. Branch locations are not known yet, so they will be set one branch at a time.
- **Done:** each branch can have its office location and an allowed distance (default 150 m, 50 m–2 km) (`branches.latitude/longitude/location_radius_m`, migration 0027). **Branches → Branch locations for clock-in** lists every active branch, those not set first, with **Use my current location** (stand in the office) or pasted Google Maps coordinates, a map check link and Remove; IT, administrators and HR can set it (`PUT /api/branches/location`). Branch List shows **Location not set**. When the employee's branch has a location, Clock In asks the phone for its location; the clock-in is always saved, and the result is kept in the new table `clock_in_checks` (Inside, Outside with the distance, No location, or Not set). Outside and Location off are flagged on the Daily board (with a count) and in Attendance Review; HR, administrators, the CEO and the President press **Accept** (day stays Present) or **Mark absent** (reason required; the record becomes Absent with its clock times kept, so payroll counts the absence), both noted in the attendance notes (`PATCH /api/attendance-tracking/location`). Branches without a location are not checked, so nothing changes until a location is saved. The app's Permissions-Policy header now allows location for its own pages (`geolocation=(self)` in `next.config.ts`). Seven new tests; build and all tests pass.
- **In progress:** none.
- **To do (owner):** run the 0027 migration on production (`npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs`, expecting 48 tables and OK) **before** deploying; deploy; then set each branch's location from the checklist.

### PH-57226493: January–September D-280 history restored (2026-10-20)

- Corrected nine PHP280 payments on `ENR-LEG-E2729791F8` from February–October/NOP24–32 to **January–September2026/NOP23–31**, D-280, HINATUAN. Original SDS-COLL rows239,692,1228,1726,2247,2711,3206,3765,4191 confirm the months; March–September NOP25–31 and DOI March1,2024 establish the sequence. January/February source NOP24/25 repeat the later sequence incorrectly; normalized to23/24, retaining the established DOI. All nine source rows matched by deterministic collection ID using `inspect-member-source-rows.mjs`, so corrected OR letters do not obscure source matches.
- Backed up `backups/member-accounts-PH-57226493-1792484150296.json`; ran existing consolidator with `config/ph57226493-coverage-20261020.json`, rollback preview then apply. Independent production verification confirms nine receipts, PHP2,520, unchanged program/DOI/dates/amounts/labels, January–September and Updated status. Nine finance snapshots recalculated, net existing incentive change zero, no linked remittance expectation changes. Recorded in Audit Log and Record Corrections.
- `lib/entry-finance.mjs` reads optional `no_incentive_reason` through row JSON, preserving the reason when present and treating it as null before that column's migration. This allows maintenance against the current production schema without an unrelated migration. Existing financial recalculation test passes against a schema without the column, including forfeitures, ORC, reactivation, linked slips and idempotence.

### OR12617 C: correct member ownership (2026-10-20)

- Owner reported OR12617 B does not belong to PH-68134668. Production and original M3-COLL row14208 identify the relevant receipt as **12617 C**, August18,2026, PHP700, D-350, July–August NOP42–43, **Dequiña, Dominador**. Moved existing collection `COL-LEG-F565251B04` from Felisa Dorado PH-68134668 to Dominador **PH-80648675**, account `ENR-LEG-FB7244DEAC`. Removed Felisa's empty erroneous D-350 account `ENR-LEG-8EE0C7DD4C` after confirming no sales/transfers/payments reference it. Her eight D-300 Bracketing receipts totaling PHP2,700 are retained.
- Backed up both members through `member-accounts.mjs`; scoped transaction backup `backups/or12617-owner-apply-20261020.json`. `correct-or12617-owner-20261020.mjs` passed rollback preview, apply and independent `--verify` production readback. Every collection field except member/account ownership is unchanged, including financial snapshots; Dominador's earlier receipt is unchanged. No remittance links or monetary changes; target status recalculated 60D. Audit Log and Record Corrections retain the correction. `inspect-or12617b-20261020.mjs --legacy` records the workbook evidence. The unrelated MINTAL receipt12617 C (duplicated), PH-44324834, is untouched.

### Remittances: see what causes a discrepancy (2026-10-19)

- **Owner:** there are discrepancies in Remittance but they cannot be clicked to see the cause.
- **Done:** the Discrepancies tile opens Pending Approval filtered to slips with a difference; **Why the difference?** on each (and on the Difference in Remittance Records) explains it: what the slip expected and recorded when made, every later change to its expected, actual or Fidelity amount and to its entries' shares (Audit Log), with who, when, the entry and OR and the correction's reason (Record Corrections), and each entry's share on the slip against now. Read-only (`lib/remittance-discrepancy.ts`, `GET /api/remittances/discrepancy`, `components/remittance-discrepancy.tsx`). Tested with the PHP9.20 pattern (balanced slip, then a program correction raising one share); build and all 208 tests pass.
- **In progress:** none.
- **To do (owner):** deploy, then open the Discrepancies tile; slips whose amounts were changed by scripts show "system / script" as who.

### Remittances: why the Date Remitted was changed (2026-10-19)

- **Owner:** in Remittance, show the reason why the Date Remitted was changed.
- **Done:** the reason typed when a batch's Date Remitted was moved off the clearing day (`date_remitted_reason`) now shows on Remittances: on each slip waiting for approval and in Remittance Records ("Date Remitted changed: date: reason"), per entry in View entries ("Remitted date: reason"), and in Outstanding Cash Aging. One small query of the entries with a reason (`dateRemittedReasons`, `lib/remittance-workflow.ts`). Tested; build and all 207 tests pass.
- **In progress:** none.
- **To do (owner):** deploy.

### Pending remittance discrepancy PHP9.20 explained (2026-10-19)

- Read-only investigation: pending MACO slip `REM-20261017032028-DZHE` expects PHP13,069; actual cash remains PHP13,059.80, difference -PHP9.20. Audit Log October17,2026 07:37:36 UTC shows OR08878T, PH-87914816, changed D-460 to D-460 (59B). At NOP22 on PHP460, MAS incentive changed 12% (PHP55.20) to 10% (PHP46), increasing expected company share PHP404.80 to PHP414. The slip was balanced before that correction. This predates the Quiñones split, which affected no linked remittances. No database changes made during this investigation. Read-only helper: `scripts/inspect-discrepancy-920-20261019.mjs`.

### Danilo Quiñones Sr.: nine receipts separated from JR (2026-10-19)

- **Done in production:** created **PH-26172119**, Danilo Quiñones Sr., D-230 (`DP-0063`), MINTAL. The nine requested receipts (10576 C through 24509 C) already existed under JR, **PH-89863784**. M3-COLL source rows explicitly distinguish SR from JR. Moved SR's existing receipts to his new account; JR retains his own nine receipts. Each now covers January–September 2026, NOP52–60, PHP2,070, DOI October1,2021, status Updated. No receipts duplicated and no unverified personal details copied to SR.
- **Evidence:** pre-change backup `backups/member-accounts-PH-89863784-1792390784001.json`; scoped config `config/ph89863784-quinones-sr-split-20261019.json`; dry run followed by apply and independent production readback (`scripts/check-quinones-split-20261019.mjs --verify`). All 18 collection IDs, OR labels, dates and amounts match the backup, all NOPs match the source, combined total PHP4,140. Duplicate OR labels preserved. Financial snapshots recalculated for 18 receipts; existing incentive change zero; no linked remittances changed. Audit Log and Record Corrections recorded the split.
- **Script reuse:** `split-member.mjs` now accepts `--config=`, optional new-member suffix, snapshot guards and optional shared financial repricing; default remains rollback. Source inspector: `scripts/inspect-nine-receipt-owner-20261019.mjs`.

### New Sales: next application number and date; Collections: OR date (2026-10-19)

- **Owner:** apply the same to New Sales application numbers, and to the OR date and the application date.
- **Checked (production, read-only, numbers and dates only):** application numbers in one save mostly go up by one in the digits after the dash (`062026-01616`, `-01617`, ...; `2026SP-0790`, `-0791`), the series as written (some `2026sp`); OR dates in Collections batches equal the previous entry's 1,144 times of 1,191.
- **Done:** New Sales → Add another sale fills the Application No. (`nextApplicationNumber`, `lib/entry-controls.ts`: digits after the dash + 1, series and leading zeros kept; blank when there is no dash) and the Application Date (same as the last sale). Collections → Add collection also fills the OR date (same as the last entry). All editable; the next one follows the edited value. Tested; build and all 207 tests pass.
- **In progress:** none.
- **To do (owner):** none; deploy.

### Collections: next OR number filled in (2026-10-19)

- **Owner:** automate the OR number: the last entry's number plus 1 with the same letter; editable, and later entries follow the edited one. Look at the batches for the pattern.
- **Checked (production, read-only, OR numbers only):** inside batches encoded in this system, 1,039 steps between entries are +1, a few +2 (a skipped receipt), a handful descending; each batch keeps one letter and one way of writing it (`09006T`, `03234 S`, `16243B`); after a jump (24750 N → 25901 N) the next ones follow the new number.
- **Done:** Add collection fills the new entry's OR with `nextOrNumber` (`lib/or-number.ts`) of the last entry: number + 1, letter, space and leading zeros kept; blank when the last OR has no letter. The clerk edits it as before; the next entry follows the edited one. Tested; build and all 206 tests pass.
- **In progress:** none.
- **To do (owner):** none; deploy with the other changes.

### New Sales: DOI time (2026-10-19)

- **Owner:** add a Time field to New Sales, joined to the DOI; by default the time it is encoded, but editable, because some programs need the time of the DOI.
- **Done:** **DOI time** under Application Date (`components/new-sales-form.tsx`), filled with the Manila time the sale card is started, editable; `/api/sales` saves it on the New Sale and the account (`doi_time`, migration `0024_doi_time`), using the time of saving when blank and refusing anything but HH:MM. MAS submissions carry it. `scripts/check-database.mjs` checks the column. Tested (typed time, default time, refused time); build and all 205 tests pass.
- **In progress:** none.
- **Done (owner: migration run on production):** the DOI time shows in Members (directory and each member's accounts, beside the DOI) and can be changed in Edit / Corrections → New Sale and My Entries → Edit batch (returned New Sales), on the sale and its account, checked as HH:MM (`isDoiTime` in `lib/entry-controls.ts`); the change is in Record Corrections and the Audit Log. Tested; build and all 205 tests pass.
- **To do (owner):** commit and push. Sales saved before October 19, 2026 have no time; add one through Edit / Corrections when a program needs it.

### Audits: no empty branch in the report's branch list (2026-10-19)

- **Owner:** in Audit, don't show the entry branch in the branch list if the report is empty.
- **Done:** the clerk report returns `activeBranches` (branches with entries, expenses, deposits or Fidelity slips in the period, `lib/clerk-report.ts`); on Audits (`hideEmptyBranches` on `ClerkReport`) the Branch list shows only those, plus the branch currently chosen, and All branches. Reports and Report Review are unchanged. Build and all 205 tests pass.
- **In progress:** none.
- **To do (owner):** deploy and open an audit for a clerk with several branches.

### Transfer to any program, months counted from the amount paid (2026-10-19)

- **Owner:** the program transfer still only allowed programs with the same pay; it should transfer to any program as long as the amount paid can be calculated correctly in the new program.
- **Done:** Programs → Transfer members, Members → Transfer → To another program and Edit / Corrections → Move between programs now list every other program. Same pay: NOPs stay as before. Different pay (`monthsAt` in `lib/program-transfer.ts`): each receipt keeps its amount and OR date and covers amount ÷ the new monthly pay (whole months; flexible target: its months while each gets the minimum, else as many whole minimums as it holds, within the monthly maximum); payments are numbered again in OR-date order from the account's first NOP, months following the DOI, and checked by the account rules. Merges into an existing account recount the moved receipts the same way (`mergeAccountInto(..., sourceMonths)`). An account with a receipt that does not work out is left and listed with the receipt; incentives follow the new program. Tested (₱300 → ₱150 move and merge, ₱450 → three months, ₱300 → ₱400 left, into a flexible program); build and all 205 tests pass.
- **In progress:** none.
- **To do (owner):** deploy, then try a transfer to a program with a different pay on one account and check its NOPs and months in the member's history.

### PH-97483925: JR D-300 Bracketing separated from SR DSP-290 (2026-10-17)

- Owner confirmed PH-97483925 is JR and owns D-300 (Bracketing); SR is a separate person and owns DSP-290. Buhangin New Sale M2-NS row188, September30,2026, application record `SALE-LEG-3C06924F7B`, is the DSP-290 enrollment. The source name omits suffix; owner explicitly supplies JR/SR identity distinction.
- Backed up; production dry run passed; applied `scripts/split-ph97483925-jr-sr.mjs --apply`. JR keeps **PH-97483925**, D-300 Bracketing/account `ENR-LEG-4F3C2FA919`, February1,2023 DOI and all10 PHP300 collections (PHP3,000). SR is **PH-39696532**, member `MEM-LEG-` ID derived deterministically by split script; existing DSP-290 account `ENR-LEG-60FBF0375D` and PHP500 New Sale moved intact to SR. Both members have explicit suffixes; no payments or finances altered.
- Personal details matched the SR New Sale, so retained on SR and cleared from JR rather than assigning SR's birthdate/address/contact to JR. No JR-specific personal data was available. Beneficiary references and DSP-290 transfer records follow SR (no beneficiaries on this sale). Audited and summarized in Record Corrections; fresh split verification passed. Staging differed from reviewed production snapshot and stopped without changes.
- `scripts/inspect-ph97483925-split.mjs` searches source identities without printing personal fields; existing generic split script handles splitting receipts within one program, so this separate-program ownership split uses a scoped script with exact account/sale guards.

### PH-29986586: DSP-290 only; registration and advance collection joined (2026-10-17)

- Owner confirmed DSP-290 is the only program. PHP500 New Sale `SALE-LEG-7B3B0C216D` dated September22,2026 was under DSP-500/account `ENR-LEG-1BFA80F55F`; DSP-290/account `ENR-LEG-A07E8CFF51` held PHP580 OR24069N, paid the same day, with separately inferred October1 DOI and NOP1–2. Source DDO2-COLL row3163 confirms October–November coverage.
- Backed up; production dry run passed; applied `scripts/fix-ph29986586-dsp290.mjs --apply`. Moved New Sale to DSP-290, corrected registration metadata to the configured PHP500 fee, set enrollment DOI to actual September22,2026 New Sale date, aligned October–November collection to NOP2–3, removed empty DSP-500 account. Preserved PHP1,080 total, OR dates, beneficiary/member data, MONKAYO branch and MAS. Status ADV; two financial entries recalculated, no remittance slip changes. Audited and recorded in Record Corrections; fresh read/idempotent verification passed.

### PH-56293596: transferred to DPB-1000 with January coverage (2026-10-17)

- Owner supplied OR4459M,4485M,8254M,8268M,8287B,8299M,8074B,8091B,15002B. All nine PHP1,000 payments belong to PH-56293596/current DPB-420 account `ENR-LEG-C443E4D5B4`, DOI January1,2025. Existing ranges NOP10–24 cover October2025–December2026, with mixed one/two-month spans. Total PHP9,000; current calculated/stored status ADV.
- Original M1-COLL rows361,1867,2766,3864,5114,6070,7422,8543,9664 conflict: January/February labels each claim two NOPs, March source D-420 claims two, April says May–June, May says June, June says July, July says August–September, August says October but two NOPs, September says September/NOP24. PHP1,000 does not equal a whole number of PHP420 installments. No reliable coverage/program correction can be inferred from this source alone.
- OR8287B has another member's PHP350 D-350 receipt (PH-02047575, source row6165); this member's PHP1,000 May15 receipt retains its duplicate flag. Do not combine them or overwrite either amount/receipt number.
- Owner confirmed **transfer to DPB-1000**, then **January2026 starting coverage for OR4459M**. DPB-1000 is DP-0042, PHP1,000 monthly, Pay the Balance category. Nine receipts each cover one month; retained January1,2025 DOI means January–September2026/NOP13–21.
- Backups saved; production exact-plan dry run passed; applied `scripts/transfer-ph56293596-dpb1000.mjs --start=2026-01 --apply`. Same member/account moved from DP-0017 to DP-0042; all nine receipts follow. Status ADV becomes U. PHP9,000 total, OR dates/labels, DOI, branch/MAS preserved; all nine financial entries recalculated with no remittance slip changes. Other member's OR8287B untouched; this account's duplicate flag retained. Fresh per-member receipt/account verification passed. Record Corrections and Audit Log record changes.
- Staging dry run stopped on differing account structure; production snapshot was explicitly guarded and validated. Scoped transfer reuses existing source-independent account and finance rules; generic bulk program mover could not express this member-only correction with changed installment spans.

### PH-76371335: keep coverage, correct stale status (2026-10-17)

- Owner supplied OR5165M,6331M,7498M,8483M,6285B,9267B,13307B,15606B, then explicitly confirmed **keep November2025–June2026 coverage; correct stale status**. Source M1-COLL rows172/1347 explicitly show November/December2025; later source month/NOP labels conflict. Do not shift these payments to January–August2026.
- Backed up; production dry run passed; applied `consolidate-member-receipts.mjs --config=config/ph76371335-status-20261017.json --apply`. D-210 HG saved status150D updated to90D; NOP24–31, November2025–June2026 coverage, December1,2023 DOI, eight PHP210 amounts (PHP1,680 total), dates and all financial fields preserved. No financial entries repriced. Fresh receipt/account verification passed; audited and summarized in Record Corrections.

### PH-04542944: current branch to NABUNTURAN (2026-10-17)

- Owner requested NABUNTURAN. Backed up account/history; production dry run passed; applied `scripts/fix-ph34623670-branch.mjs --member=PH-04542944 --to=NABUNTURAN --from=MAWAB --account=ENR-LEG-7BA440C577 --apply`. Current DPB-350 enrollment and branch link changed from MAWAB to NABUNTURAN. MAS DNDO-2026-0027 already assigned to NABUNTURAN; retained. Historical receipt branches/payment data preserved. Fresh read verified the branch/link; audited and summarized in Record Corrections. Existing branch script now accepts explicit member/to/from/account parameters while retaining original defaults.

### PH-87758804: all receipts to D-460 (59B) (2026-10-17)

- Owner confirmed all payments belong to D-460 (59B). Source DDO2-COLL rows293,709,1494,1821,2255,2408,2631,3210,3273 confirm December2025–September2026/NOP9–18; OR15231N is PHP920 covering December–January. OR23129N and24798N were misfiled under D-460; source August/September NOP17/18 had been shifted by the split.
- Backed up; production dry run passed; applied `consolidate-member-receipts.mjs --config=config/ph87758804-d46059b-20261017.json --apply`. Nine payments now belong to DP-0022/account `ENR-LEG-308903D268`; empty D-460/account `ENR-LEG-9CE4CFE9F3` removed. Corrected continuous coverage/NOP9–18 and status U. PHP4,600 total, OR dates, April1,2025 DOI, COMPOSTELA branch and MAS preserved. Three financial entries recalculated, no remittance expectation changes. Fresh receipt/account verification passed; audited and summarized in Record Corrections.
- Staging dry run rolled back on missing MAS tier NOP18; production configuration passed.

### PH-93383039 / PH-79193890: owner-requested member/account merge (2026-10-17)

- Owner requested merging both members. Kept first-listed PH-93383039 (`MEM-LEG-6FACD9762B`, account `ENR-LEG-D7DD31DE26`); removed redundant PH-79193890/account `ENR-LEG-F98136C187`. Same D-250 FG, September1,2024 DOI, TORIL, MAS ABENOJA JESSICA. Seven receipts joined the kept account's June receipt.
- Original M1-COLL rows1026,2251,3518,4592,5817,7219,8395,9713 establish January–August2026/NOP17–24. July/August payments had been shifted to June/July because the true June receipt was on the other member. Restored continuous history; all eight PHP250 payments retained (PHP2,000), dates/DOI/branch/MAS preserved, status U. OR9577B duplicate label/flag retained because another source receipt uses that number.
- Backed up both members, passed production dry run and applied `merge-name-variants.mjs --config=config/ph93383039-ph79193890-merge-20261017.json --apply`. Fresh reads verified all receipts on the retained member/account and removed member absent. Financial fields recalculated; missing personal fields filled from removed member where available. Audit Log and Record Corrections record changes.
- Extended existing merge script with scoped config, optional detail filling/repricing, account locks and rollback dry runs. Staging dry run rolled back on missing MAS tier at NOP23; production configuration passed.

### PH-23767391: nine D-280 receipts shifted by June NOP typo (2026-10-17)

- Owner supplied OR14832N,15536N,18705N,19573N,02808T,20176N,21510N,2344N,25072N. Source DDO1-COLL rows666,1554,2711,3629,4450,5427,6060,7039,7833 and September1,2023 DOI establish January–September2026/NOP29–37. June NOP24 is a typo for34, which caused imported August2025–April2026/NOP24–32.
- Backup saved; production dry run passed; applied `consolidate-member-receipts.mjs --config=config/ph23767391-d280-20261017.json --apply`. Restored January–September2026/NOP29–37, status150D to U. Nine PHP280 amounts (PHP2,520 total), OR dates/labels (including source2344N), DOI and program retained. Financial fields recalculated; no remittance expectations changed. Fresh account/receipt verification passed; audited and summarized in Record Corrections.
- Staging dry run skipped because this member has no D-280 account there; production account and original workbook verified directly.

### PH-25389794: seven listed DPB-420 receipts repaired (2026-10-17)

- Owner supplied OR5357M,6407M,8142M,3924B,8504B,8537B,13963B. Original M1-COLL rows514,1494,3666,4966,6135,7303,9466 establish January–August2026 coverage/NOP5–12. March source NOP3 is a typo for7; September1,2025 DOI and all other source NOPs agree. Import shifted coverage to November2025–June2026/NOP3–10.
- Backup saved; production dry run passed; applied `consolidate-member-receipts.mjs --config=config/ph25389794-dpb420-20261017.json --apply`. Restored NOP5–12/January–August2026; OR13963B remains PHP840 covering July–August. Status150D becomes U. Six PHP420 receipts plus PHP840 total PHP3,360; OR dates, DOI and program retained. Financial fields recalculated with no remittance expectation changes; fresh verification passed. Audited and recorded in Record Corrections.
- Staging dry run rolled back because its first-year MAS tiers are missing; production has the required configuration and passed.

### PH-34623670: current branch to MAWAB (2026-10-17)

- Owner requested branch MAWAB. Backed up account/history, passed production dry run, then applied `scripts/fix-ph34623670-branch.mjs --apply`: DPB-350 enrollment `ENR-LEG-DEB62351C9` moved from NABUNTURAN to MAWAB, including its branch link. Existing MAS DNDO-2026-0027 already assigned to MAWAB; retained. Historical receipt branches and payment data preserved. Audit Log and Record Corrections record the change; fresh read confirmed MAWAB and matching branch ID.

### Lugon Arman and Lugon Juliet: selected 2025 workbook import (2026-10-17)

- Owner supplied `legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx` and requested these two people only. Source M2 - COL. rows8949/8950 contain OR13395/13396, each PHP2,760 paid October9,2025 and remitted October10,2025, NOP49–60 covering October2025–September2026, D-230, AGDAO, Capacite C.
- Imported on production: Arman **PH-12779702** (`MEM-LEG-DD0C1DFE98`, account `ENR-LEG-AD31E73D58`, receipt `COL-LEG-434F5E56F7`); Juliet **PH-98306704** (`MEM-LEG-4DCF27D7F3`, account `ENR-LEG-73259330E0`, receipt `COL-LEG-D02C36606A`). Both U as of October17,2026. DOI October1,2021 inferred from October2025/NOP49, following the existing collections-only migration convention. No source New Sale, birthdate, address or contact exists; none invented. Financial shares remain unpriced as in the existing workbook importer.
- Existing `migrate-legacy-members.mjs` was inspected and a staging dry run attempted, but its MONTH OF parser does not support this cross-year range. `scripts/import-lugon-2025.mjs` reuses `legacy-sources.mjs` and `account-rules.ts`, strictly checks both original source rows, resolves existing people/receipts before insertion, checks unambiguous AGDAO/MAS mappings, and saves both people/accounts/payments in one transaction. MAS linked to MD-2026-0035, branch BR-0005. Deterministic IDs match the legacy import conventions; reruns skip already imported matching receipts and stop on conflicts.
- Production dry run rolled back successfully before `npm run prod -- node scripts/import-lugon-2025.mjs --apply`. Fresh per-receipt verification confirmed PHP2,760 each (PHP5,520 total), 12-month coverage, NOP49–60, separate member accounts and error-free account states. Record Corrections stores source references and workbook SHA256; local backups store preview/applied summaries. `scripts/inspect-lugon-import.mjs` scans the source without printing personal details.

### PH-86155816: D-270 (300) shifted coverage repaired (2026-10-17)

- Owner requested repair. Source M3-COLL rows1446,3426,4698,6463,8454,10783,12516,14286,15945 show January–September2026. March NOP15 caused imported NOP15–23/September2024–May2025. July1,2023 DOI and April–September source NOP34–39 establish January–September NOP31–39; January30/February31 source NOPs are one low.
- Backed up, passed production dry run, then applied `consolidate-member-receipts.mjs --config=config/ph86155816-d270-20261017.json --apply`. Restored January–September2026/NOP31–39; stored status150D becomes U. Nine PHP270 amounts (PHP2,430), OR dates and DOI preserved; financial fields recalculated with no remittance expectation changes. Fresh account/receipt verification passed; audited and recorded in Record Corrections.
- April OR9875M duplicate flag/label retained: M3-COLL row6223 assigns the same number to PH-29539584's April14 PHP210 payment, while this member's row6463 is April17 PHP270. Actual receipt number requires owner confirmation. No payment removed or renamed.
- Staging dry run rolled back on missing MAS incentive tiers for NOP36; production tiers are configured and production dry run passed.

### PH-96391262: D-230 coverage shifted by March NOP typo (2026-10-17)

- Owner requested repair. Original M3-COLL rows 388,2248,4118,6222,8145,10046,11931,14025,15868 show January–September 2026. January–February NOP46–47 and April–September NOP49–54 agree with April 1, 2022 DOI; March NOP28 is a typo for48. The import used that minimum and shifted nine receipts to NOP28–36, July2024–March2025.
- Account/receipt backup saved; production dry run passed; applied `consolidate-member-receipts.mjs --config=config/ph96391262-d230-20261017.json --apply`. Restored January–September2026/NOP46–54 and status 150D to U. Nine PHP230 payments (PHP2,070 total), OR dates, DOI and program retained. Financial fields recalculated; no remittance expectations changed. Audited and recorded in Record Corrections; fresh receipt/account verification passed.
- Staging dry run skipped: this member has no D-230 account there. Verified production account and original workbook directly.

### PH-39400344: D-230 coverage shifted by a source NOP typo (2026-10-17)

- Owner requested member repair. Original M3-COLL rows 667,2619,4631,6504,8343,10388,12298,14292,16014 show January–September 2026. January NOP47 and March–September NOP49–55 agree with March 1, 2022 DOI; February NOP28 is a typo for48. The import used that minimum and shifted all nine receipts to NOP28–36, June2024–February2025.
- Backup saved, production dry run passed, then applied `consolidate-member-receipts.mjs --config=config/ph39400344-d230-20261017.json --apply`. Restored January–September2026/NOP47–55; status 150D becomes U. Nine PHP230 amounts (PHP2,070 total), dates, DOI and program retained. Financial fields recalculated; no remittance expectations changed. Recorded in Audit Log and Record Corrections; fresh receipt/account verification passed.
- Staging dry run skipped because staging has no D-230 account for this member; production source and account were verified directly.

### PH-73303959: historical Needs review repaired (2026-10-17)

- Read-only production diagnosis reproduced D-280 historical coverage-gap errors for February–June 2026. OR 13335 B (`COL-LEG-C8A2D15A6B`) pays June, NOP 44, PHP280, but is dated January 31, 2026. Earlier NOP 39–43 receipts arrive February–July. Today's D-280 calculation succeeds (90D), but stored status is stale (150D); D-350 (5Y) calculates 150D with no history errors.
- Original workbook M1-COLL row 9359 also says January 31, with encoding timestamp September 1 and Date Remitted September 1. Owner confirmed the actual OR date is **September 1, 2026**.
- Backup saved with `member-accounts.mjs PH-73303959 --show-payments --backup`. Applied on production with `scripts/fix-ph73303959-or-date.mjs --or-date=2026-09-01 --apply`, after the exact-date dry run. Historical February–June review errors are cleared; D-280 stored status updated from 150D to 90D, D-350 (5Y) remains 150D. All six receipt amounts (PHP2,030 collections), coverage, financial fields and both programs retained. Audit Log and Record Corrections record the repair; a fresh read verified the corrected date and error-free historical calculations.

### PH-80673488: all payments to D-250 FG (2026-10-17)

- Owner confirmed all payments belong to D-250 FG. Moved ORs 4481 M and 8270 M from the erroneous D-210 HG account into the existing D-250 FG enrollment, then removed the empty D-210 HG account (no New Sale or transfers).
- Five PHP500 receipts (4481 M, 8270 M, 8056 B, 8073 B, 08100 B) retain their dates, amounts, NOP 10–19 and continuous February–November 2026 coverage. DOI remains May 1, 2025; status recalculated to ADV; collections total PHP2,500.
- Applied on production with `scripts/fix-ph80673488-d250fg.mjs --apply`, following member/account backup and staging/production dry runs. Audited and summarized in Record Corrections.
- Financial limitation: the general consolidation script rolled back because D-250 FG lacks first-year MAS incentive tiers. The scoped repair verified all five imported receipts had empty financial fields and no remittance links, and preserved those fields. No incentive rates were invented. Configure applicable first-year tiers before pricing those legacy receipts. Reviewed consolidation plan: `config/ph80673488-d250fg-20261017.json`.

### PH-08543913: five-OR member data repair (2026-10-17)

- Owner supplied 9918 M, 16667C, 18751C, 19293 C and 22770 C to identify a member needing correction. All belong to PH-08543913, D-350 (5Y), DOI March 13, 2026; the account also has September OR 24379 C.
- Original workbook M3-COLL rows 6295, 8904, 10179, 12237, 14386 and 16135 confirm April–September coverage. June's source OR date is malformed (`6/12/0206`); July/August source NOPs are inconsistent. Stored June OR 18751C had been placed as NOP 7 for September, displacing the later receipts.
- Applied on production with `scripts/consolidate-member-receipts.mjs --config=config/ph08543913-receipt-sequence-20261017.json --apply`, after backup and production dry run: six receipts now cover April–September as NOP 2–7; stored status 90D becomes U. Existing OR dates, amounts (PHP 2,100 collections), DOI, member identity and program retained. Changed NOP financial fields and the New Sale were priced from production's configured tiers; no remittance slip changed. Audit Log and Record Corrections retain the correction.
- Staging dry run rolled back because its D-350 (5Y) first-year MAS incentive tiers are missing; production has the required tiers and passed. `scripts/inspect-or-member-20261017.mjs` provides read-only record inspection; `--legacy` also checks source workbook metadata.

The [user-provided specification](dayong-system-specification.md) is the baseline business and architecture reference, supplied on 2026-09-25. It is preserved as provided and includes historical descriptions, intended features, examples, and unresolved rules; it is not a verified inventory of implemented features.

This is a living project. Later explicit user decisions supersede earlier requirements. Record confirmed changes here or in the relevant feature document as development progresses. Verify implementation claims against the code and live schema when working on a feature. Do not treat unfinished examples as final policy or implement all planned features merely because they appear in the specification.

## Core business rules

- Use **Dayong System**, **Dayong Database**, or **2026 DAYONG DATABASE V3** in user-facing naming; avoid “temporary.” The existing repository directory name does not need to change.
- A Member is the person; a Member Program is the account. Reuse the Member when enrolling in another program.
- Payments, NOP, MAS assignment, status, balances, incentives, and account history belong to the Member Program. MAS may differ between a member's programs.
- Preserve historical MAS responsibility during transfers. Later assignments must not rewrite earlier reports.
- Record real collections separately from the months they cover. Multi-month payments need payment allocations; collection dates and covered months are distinct.
- Incentives are configurable by program, role (MAS or Collector), and non-overlapping payment-period tiers. Where the specified percentage rule applies: `(base pay - mark up) * rate + mark up`. Do not assume this determines every incentive case.
- TMD is monthly amount multiplied by NOP. The baseline specification lists balance multipliers ADV = 0; U = 1; 60 D = 2; 90 D = 3; 120 D = 4; 150 D = 5; NS = 1. Do not equate the displayed balance with unpaid arrears without confirming that distinction; payments cover whole monthly installments as clarified below.
- MAM means Member Account Monitoring. Generate it from operational data; it is not an independently maintained account table. Never invent collections to make monthly reports display correctly.
- Keep staff identity, operational responsibility, login permissions, and the person encoding a transaction distinct.
- Google Sheets is the current operational store. Keep credentials server-side, normalize records in the data layer, use stable IDs, and validate business rules in the API.

## MAM business clarifications

The following user clarifications supersede conflicting examples in the baseline specification. The implementation status and remaining limitations are recorded in [MAM implementation](mam-implementation.md).

- NOP starts with the first collection payment for the Member Program. New Sales does **not** count as the first NOP. Do not turn the New Sales payment into NOP 1 or count it again as a collection.
- NS means **New Sales**; U means **Updated**; ADV means **Advance**.
- 60 D means one month delayed; 90 D means two months delayed; 120 D means three months delayed; 150 D means four months delayed. The status scale stops at 150 D.
- Temporary suspension begins **two months after the applicable timing anchor for that specific Member Program**, not at the 150 D limit. A waiver is required when the member pays again. At **six months and one day after that anchor**, the account is forfeited. Use the payment/DOI rules and the advance-coverage exception below. These clarifications supersede the earlier suspension-at-150-D rule.
- Payments must cover whole monthly installments. At a monthly rate of PHP 350, a member must pay PHP 350 for one month; PHP 100 is not an allowed partial installment. Multiple months cost the applicable full installment amounts (for an unchanged PHP 350 rate: PHP 700 for two months, PHP 1,050 for three).
- "Partial payment" means paying only some of the months owed, not part of one month's installment. A member owing two months (PHP 700) may pay one month (PHP 350), leaving one month unpaid. This supersedes the earlier interpretation that arbitrary partial installment amounts were accepted.
- Members may pay full installments for future months in advance. Record the actual collection and its covered months; do not discard advance amounts or invent later collections. Paying some arrears does not by itself make an account Updated if other due months remain unpaid.
- MAM defaults to the present month, but the latest user request adds **From/To month selection** with horizontal scrolling. This supersedes the earlier present-month-only scope.

Fractional-installment accumulation is not needed. Implementation defaults to continuous oldest-unpaid-month-first coverage, beginning in the DOI month for a new account, so advance payments cannot skip arrears. Historical imported accounts use their existing coverage baseline; inconsistent histories are flagged for review. New Sales remains excluded from NOP.

### Collections NOP entry and advance eligibility

- Collections shows **NOP From** and **NOP To** for both NS and non-NS accounts. The first collection payment can cover several months, so the range also applies to NS. This supersedes the earlier single-NOP-field requirement.
- The New Sale itself counts as **NOP 1** (the DOI month). An NS account's first collection therefore starts at **NOP 2**, for the month after DOI.
- For every status, including NS, Collections shows **NOP From** and **NOP To** as automatically calculated, non-editable fields: NOP From continues from the account, and NOP To follows the covered months the clerk selects. The server enforces the calculated values rather than trusting a submitted range.
- Each covered month maps to its corresponding NOP. For example, January through March with NOP From 1 and NOP To 3 means January = 1, February = 2, March = 3. These month names and NOP values are illustrative, not fixed starting values.
- Advance payment is allowed only when the payment brings the account to U or ADV. An account with arrears may pay enough to catch up and cover future months in the same payment; it may not skip unpaid due months to pay future months while remaining overdue.
- Account status (NS/U/ADV/delinquency) is distinct from a transaction's posting status and from the existing Active/Inactive-style UI field. Do not let a manually selected status bypass payment or NOP validation.

Collections now uses each entry's calculated account status for NOP editability. The backend validates NOP against stored and pending batch payments, whole installments, continuous coverage, waivers, Collector information, and forfeiture. Amount Collected is automatically calculated and read-only.

### Collector tracking, suspension, and forfeiture

- **Original MAS / Officer's Name** is no longer asked for. A Collector always collects for the batch's own MAS (chosen at the top of Collections), so the server records that MAS as the original MAS for Collector batches. The Collector, the MAS, and the signed-in encoder remain separate identities.
- Collections now has a separate **Collected By Role** field (MAS or Collector). The original MAS for Collector entries is the batch MAS, recorded automatically. The role is not inferred from the signed-in encoder.
- "Suspended" means **temporarily suspended**, per Member Program, after two months without payment. Resuming payment requires the existing Collections **If Suspended → Waiver** option (`ifSuspended: "Waiver"`). The user confirmed this existing control should be used; do not add a separate checkbox, reference requirement, or upload flow. Visitation Form and Other exist in the dropdown but have not been approved as substitutes for the required waiver.
- An account becomes **forfeited after six months and one day without payment**. The user confirmed its status must become **Forfeited** and **payments must be blocked**. Enforce this on the server as well as the form; a waiver must not bypass forfeiture. No reinstatement exception is authorized.
- Payment-status labels (NS/U/ADV/60D/90D/120D/150D) and suspension/forfeiture are distinct concepts. The existing 150D cap does not replace the six-month-and-one-day forfeiture rule.
- Both suspension and forfeiture are calculated per Member Program. Payments to another program do not reset this program's interval.
- Use the latest **OR Date** for ordinary payments, not Date Remitted or encoding timestamps. Before the first collection payment, start from **DOI**. New Sales remains excluded from NOP.
- **Advance-payment exception (latest clarification):** when payment covers future months, start the clock from the **last advance month covered**, rather than from the earlier OR Date. For example, a September payment covering September through November anchors the clock to November. Preserve OR Date as the actual transaction date; do not change it to the covered month or manufacture later collections. This supersedes the earlier statement that advance coverage does not extend the clock.
- The user confirmed the advance-coverage anchor is the **DOI day within the last covered month**, not month-end. For example, DOI day 15 with advance coverage through November anchors the clock to November 15. Apply the two-month suspension and six-month-and-one-day forfeiture intervals from that date. Implementation clamps a DOI day that does not exist in a month to that month's last day, including leap years.
- Suspension/forfeiture calculations, waiver enforcement, and Collector validation are implemented. The application calculates status on reads; sheet status is initialized for new accounts, updated on collection saves, and reconciled by MAM's **Sync current statuses** action. No background scheduler is configured.

## Account-status sheet preparation

The live `Member programs` sheet now has **Account Status** in column **S**, after encoder columns O:R. Its dropdown accepts `NS`, `U`, `ADV`, `60D`, `90D`, `120D`, `150D`, and `Forfeited`. Existing column M (`Status`, currently used for Active) and Collections column T (`Status`, used for Posted) retain their separate meanings. Account status belongs to each enrollment, not the Member as a whole.

Collections also has Z **Collected By Role**, AA **Remittance Amount**, and AB **Remittance Breakdown**. Remittances has K **Gross Collection** and L **Total Remittance**. These are appended after the encoder columns.

Migration: `node scripts/migrate-account-status.mjs --apply` (omit `--apply` for a dry run). The migration checks layout and occupied columns, adds the header and dropdown, and preserves existing row values. Historical row values were preserved by migration. New enrollments initialize column S to NS. Account calculations derive status from program-specific collections; the current sheet value is not used to override payment history except to preserve a recorded Forfeited block.

## Implemented encoder tracking

[Encoder tracking](encoder-tracking.md) has been implemented across business saves. It uses the verified session identity and a server timestamp, records latest attendance editors separately, and preserves original encoders. Live tracking headers were migrated without attributing historical rows to guessed users. This supplements the supplied specification.

## Members master data

`/members` provides a read-only directory with name/PH number/contact search and branch, MAS/officer, program, member status, province, and city filters. Combined enrollment filters must match the same enrollment. Each member appears once, including members without enrollments. Results paginate at 25 members; details show personal/contact/address/claimant information and all program enrollments. The authenticated `/api/members/directory` reads existing sheets without changing their schema or the Collections/New Sales member-search API. Member status comes from Members column AD; enrollment status comes from Member programs column M. Payment status is calculated using the current MAM account report and displayed per enrollment. Filters include NS, U, ADV, 60D, 90D, 120D, 150D, Forfeited, temporary suspension, and accounts needing review. Payment status and branch/program filters must match the same enrollment; calculation failures are shown rather than replaced with stale sheet status. Refresh reloads current sheet records. Filtering and pagination are client-side after loading the directory; large datasets may later require server-side pagination.

## Employees implementation

`/employees` lists and registers employees independently of login accounts. The live Employees sheet uses A:I for Employee ID, Full Name, legacy primary Branch, Operational Roles, Employment Status, Contact Number, Email, Date Hired, and Created At; J:M holds verified encoder metadata. Multiple branch assignments use the normalized `Employee Branches` junction sheet (`assignment_id`, `employee_id`, `branch_id`, then encoder metadata), so employees can be assigned to several stable branch IDs. Registration requires manage-users permission, creates an active employee with an automatically allocated DPE ID, restricts assignments to active registered branches, and supports multiple operational roles. Clicking an employee shows all assignments and details; administrators can edit the employee, roles, branches, contact information, date hired, and active/inactive/resigned status. They can delete an employee only when no User account is linked to that employee ID. User Accounts automatically checks account roles matching an active employee's operational roles while allowing the administrator to adjust the final role set.

Branches now include a `territory` column. The supplied 25 territory/branch records were migrated with stable IDs; duplicate branch names such as BUTUAN remain distinct through their IDs and territory. `npm run sheets:branches -- --apply` performs the schema and seed migration and imports unambiguous legacy employee branch names into `Employee Branches`.

Employees sign in with their Employee ID and password; there are no usernames. Each signed-in user can change their own password in Settings after verifying the current password. Password changes require at least 12 characters and reject a small local list of commonly used credentials. Role assignments and account status remain administrator-controlled, following least privilege; password recovery by email is not available until a verified email-delivery and reset-token service is configured.

`node scripts/migrate-employees.mjs --apply` creates the sheet and imports missing staff IDs, names, and branches from Users. Five existing IDs were imported. Employment status, operational roles, dates, and historical encoder identity are left blank when unknown; review these fields in Sheets. Existing operational choices retain legacy Users fallback for unreviewed staff. Sequential DPE allocation, like existing user-ID allocation, is not protected by a distributed lock; concurrent registrations across server instances need a transactional allocator before scaling.

Members supports ascending/descending sorting by name, PH number, city, province, and member status before pagination. Employees supports search, branch/role/status filters, sorting, and pagination.

## Migration-ready Google Sheets

The application-managed tabs now have a canonical database schema in `config/sheet-database-schema.json` and a read-only audit available through `npm run sheets:audit`. The audit checks stable primary keys, duplicate IDs, merged cells, blank rows inside tables, canonical lowercase headers, and known column types. The original 15 application-managed sheets were migrated to lowercase `snake_case` headers, and the two Finance sheets were created with canonical headers. Runtime header checks accept canonicalized names while continuing to guard numeric column positions.

Fidelity Savings (rule changed 2026-10-02) is the employee's own money handed over with a batch: it is added to the total remittance, never deducted from incentives, and has no limit. Since 2026-10-30 nothing is locked: the first ₱10,000 (base) is withdrawn by percentage or fixed amount, the excess above it on its own, or the whole balance, any time. See `docs/fidelity.md`.

Every active employee may be assigned member accounts through the fields historically labelled MAS. New Sales and Collections therefore search the complete active employee directory. Every role receives the shared employee workspaces: My Members, My Fidelity, MAM, Attendance, Leave Requests, Master Data, and Settings; role-specific operational and administrative modules remain additional navigation.

New employee records use the company ID format `MD-20##-####` (prefix, year, number). Existing legacy IDs remain readable. `Users.role_id` mirrors the account's primary role for database interoperability, while the `User Roles` relationship remains authoritative for additional roles. New Sales stores the member and claimant complete addresses in the canonical single-line `address` and `claimant_address` fields; legacy component columns remain readable for historical records.

## Collections and physical Remittance

Collections and Remittances are now separate transactions. Saving Collections immediately records member payments as `Outstanding`; it no longer creates a Remittances row. A physical turnover is created from selected outstanding Collection IDs, stores expected and actual cash separately, and uses the `Remittance Collections` mapping sheet. Submitted turnovers are `Pending Approval` or `Discrepancy`. Only approval changes linked Collections to `Remitted` and clears cash accountability; rejection requires a reason and returns the Collections to `Outstanding`. The submitter cannot decide the same Remittance. Historical Collections and automatic Remittances from the previous design are marked for review rather than assumed to represent verified turnover. See `docs/collections-remittance-workflow.md`.

Collections member search is scoped by the selected Branch and MAS through active Member Program enrollments. Search results include only the programs matching that same Branch/MAS relationship. A member with one eligible program has it selected automatically; a member with several eligible programs requires the encoder to choose. Changing Branch or MAS clears previously selected members and programs. Collection history is ordered from the latest NOP to the oldest.

New Sales uses Application Number as its required transaction reference. It does not ask for or require an OR Number; the legacy Sales `or_number` column remains blank for new rows so existing column positions and historical data remain intact.

## Editable amounts per program (2026-10-03)

Programs T `new_sale_amount_editable` and U `collection_amount_editable` hold TRUE or FALSE; blank reads as FALSE. FALSE, the default and the value set on every program on 2026-10-03 (`npm run sheets:program-amount-lock`), locks the amount so it cannot be mistyped. A New Sale is then fixed to the registration amount, or one month's base pay without a registration fee, and the server rejects any other amount. A Collection is fixed to covered months × base pay, and the exact remaining payoff is offered as a button. The server already accepts only full installments or that exact payoff. Administrators change the flags in Programs.

## Incentive deadline and Today's Entries (2026-10-03)

- **Deadline:** an OR has a date only, so the countdown starts at the 10:00 AM remittance cutoff on the OR date. A MAS or Collector keeps the incentive on a Collection or New Sale only when the cash is received by **10:00 AM the next day** (`lib/remittance-deadline.ts`). New Sales count from their Application Date (Sales AE), or the Manila date the sale was created when it is blank.
- **Time received:** remittance slips record the date and time the cash was handed over (Remittances D `date_remitted`, AA `time_remitted`), not when the slip was encoded, so a clerk encoding late does not cost the MAS the incentive. The encoded time stays in the slip's identity columns, so backdated times can be compared.
- **Forfeiting:** when a slip is created after the deadline, the item's full amount is due. Its company share (Collections AA, Sales AP) becomes the full amount, Sales AO `mas_incentive` becomes 0, and the incentive taken back is kept in `forfeited_incentive` (Collections AM, Sales AR). Reports, commissions and payroll read incentive as amount less company share, so they follow automatically. A rejected slip gives the incentive back; the next slip decides again. Columns are added by `npm run sheets:remittance-deadline -- --apply`.
- **Today's Entries** (`/todays-entries`; Entry Clerk, HR, Administrator): New Sales and Collections for a day, counted by remittance date (default), date encoded, or OR date. Administrators set the company default in the page (stored in the `System Settings` sheet, key `today_mode`), and the dashboards' "today" tiles use the same setting. Administrators can correct entries there with a reason (Record Corrections). OR number and OR date can always be fixed, including legacy rows; amounts only before the item is on a remittance slip.

## Data-entry controls (2026-10-03)

- **Control total:** before saving a New Sales or Collections batch, the clerk types the **net total (total remittance)** from the MAS's turnover sheet: amount collected less incentives, plus Fidelity; the penalty is separate (`lib/entry-controls.ts`; the server checks its own calculation). Until October 7, 2026 it was compared with the total collected. Until October 29, 2026 the batch saved only on an exact match; now short or over saves and is recorded (`lib/turnover-variance.ts`, see the October 29 entry at the top).
- **Late entries:** an OR or application date older than yesterday needs a reason, kept in Collections AN / Sales AS `backdate_reason` and listed in Exceptions for 30 days.
- **Cash count:** a slip may carry a bill-and-coin count (₱1000 to ₱1) in Remittances AB `cash_count` (e.g. `1000x3, 500x1`), and the server checks that a submitted count adds up to the amount. Since slips became automatic (later on 2026-10-04), no screen collects a count.
- **Member check:** Collections shows the selected member's birthdate, address and last payment, and warns when another member has the same name.
- **Exceptions** (`/exceptions`, administrators): impossible dates, amounts that do not match the program, duplicate OR/application numbers and members, active members missing birthdate/contact/address, cash past the incentive deadline, and late entries. Imported (`-LEG-`) records are hidden unless included. Sales and Collections are fixed in place with the correction form; members open in the Members directory.
- **Date checks** (`lib/date-checks.ts`): the receipt (OR or application date), the date remitted, the remittance slip and the date recorded must come in that order and close together. Remitted before the receipt or in the future is refused on save. A receipt dated after it was recorded, cash remitted more than 7 days after the receipt, an entry encoded more than 30 days late, or a slip dated differently from the entry are warnings: shown on the forms, flagged on Today's Entries, and listed in Exceptions under Dates out of order. Collections AO `date_remitted` keeps each batch's Date Remitted (it was not stored before). Imported collections have no date remitted; their `created_at` is the old form's timestamp.
- **Today's Entries** has View (everyone) and Edit (administrators). View shows every recorded detail of the entry, including date remitted and remittance slip, with any date warnings first.
- Columns AN, AO, AS and AB are added by `npm run sheets:remittance-deadline -- --apply`.

## Automatic absences and MAS member privacy (2026-10-03)

- **Absent by default:** once a working day ends (after 11:59 PM), every active employee with no attendance record for it (no clock-in, no approved leave, not marked Absent or AWOL) is recorded Absent with the note "Absent by system: …", encoded by "System" (`lib/auto-absence.ts`). Sundays and non-working days for the employee's branch are skipped. With no scheduler, days are closed the first time My Attendance, Attendance Review, Attendance Tracking or a payroll calculation runs afterwards. It applies from the day it first ran (System Settings `auto_absent_from`), never to older days. Attendance Review shows these as "Absent · by system" and the Tracking board as "Marked absent by the system"; marking the employee in Attendance Review replaces it. Payroll reads one record per employee per day.
- **MAS privacy:** a MAS without an oversight role (Administrator, Finance, CEO, President, Entry Clerk, HR) sees only the accounts where they are the assigned MAS in MAM, a member's MAM, and the Members directory (`lib/member-scope.ts`).

## Entry Clerk reports and receipt photos (2026-10-04)

- **Clerk reports** (`lib/clerk-report.ts`, `components/clerk-report.tsx`), revised 2026-10-04 to the company's Daily/Weekly/Monthly Report sheets: header (company, address, SEC Reg No., logo, report name, Branch, Entry Clerk, Date + Week); New Sales and Collections sections side by side (rows by MAS for a day, by date for a week, by week of the month for a month, by month for a year: Accts, Gross, Inc, Net, Fid/bond); Expenses/Other Cash Out (expenses the clerk encoded) and Cash Flow Transactions (cash the clerk forwarded to the bank); the cash summary (Cash Beg/Pending COH = the clerk's remaining cash on hand before the period, Sales Net, Collection Net, Fidelity Bond, Pending cash to be encoded, Total Cash In, Expenses, Cash forwarded to bank, Total Cash Out, Remaining Cash on Hand, TOTALS); Specific Rmks, Pending Transactions and Other Comments; and for weekly, monthly and yearly the summary sheet New Member and Collection by Marketing Account Staff (CVE columns not yet defined). Rows count what the clerk encoded, by date encoded; weeks start Monday. On their own report the clerk records expenses (saved in Expenses for their branch), bank deposits (`Bank Deposits` sheet, voided rather than deleted) and the notes (`Report Notes` sheet, `lib/clerk-cash.ts`). Reports shows each clerk only their own, as tabs; Report Review and Audits choose the clerk, with the entry checklist and reviewer remarks. Audit figures come from the same report.
- **Receipt photos** (`lib/receipt-photos.ts`, sheet `Receipt Photos`): the browser shrinks each photo (grayscale, at most 1280 px, WebP or JPEG) to at most 80 KB; it is stored as base64 split across up to four cells (a cell holds 50,000 characters). One photo may cover several entries. Clerks attach them in My Entries (`/my-entries`) to entries they encoded; administrators to any. An administrator cannot approve a submitted remittance until every item has a photo. Attaching the photos is what sends entries to Pending Approval (see Remittance approval flow below); since 2026-10-14 New Sales and Collections require at least one photo on the form (any number allowed), except batches paid in cash (2026-10-16: optional, by the batch's remittance method; New Sales now pick the method once per batch from the remittance methods list, as Collections do), and more can be added later in Today's Entries or My Entries. Cash received in full (approved at once, without waiting for photos) is for approvers only (2026-10-04). Photo data columns are masked in the Audit Log.

## Employee IDs (2026-10-04)

- The 95 MAS named on old-data accounts who were not employees were registered with `scripts/register-legacy-mas.mjs`: temporary IDs `LEG-2026-NNNN`, the exact name on their accounts, role MAS, status active, every branch where they have accounts (primary = most accounts), no sign-in account. "Others", "DTO" and "Cuizon-DTO" were skipped.
- Administrators can change an Employee ID in Employees → Edit (`lib/employee-id-change.ts`). Every column whose header ends in employee_id / Employee ID, in every tab except the Audit Log and the Legacy Pending tabs, is rewritten from the old ID to the new one (Users too, so the person signs in with the new ID), plus Report Notes keys. Each edit is in the Audit Log and the change is summarized in Record Corrections. Record IDs that only contain the old ID (EBA-…, ATT-…) are left alone.

## Legacy repair rules (2026-10-04)

`scripts/migrate-legacy-members.mjs --pending --repair` fixes failing old-data accounts by the company's rules: an unreadable AMOUNT COLLECTED becomes the program's monthly rate x the months covered (or the usual monthly amount paid for the program when it has no rate); an unreadable OR DATE becomes the DATE REMITTED; the same OR number twice on one account keeps one; missing NOPs and receipts claiming the same NOP or month are fixed by renumbering every payment consecutively in OR-date order (from NOP 2 after a New Sale, else from the account's first NOP), each covering the months its amount pays at the program rate. An account with no usable DOI takes its first OR date as the DOI. Every payment must be an exact whole number of monthly payments at the program rate; an account with any other amount is not imported and is listed for review. Only accounts that fail as recorded are repaired. Every change is listed in the `Legacy Repairs` tab (row reference, before, after), and with `--apply` the imported rows are removed from the Legacy Pending tabs. On 2026-10-04 this imported 598 accounts and 4,151 collections.

**Pending old-sheet accounts (October 9, 2026).** The Legacy Pending tabs now hold 3 New Sales and 59 collection rows in 32 accounts (staff fixed the rest). An OR date before 2000 or after today now counts as unreadable and takes the DATE REMITTED, on New Sales and Collections (owner: DDO 2-NS row 206 was typed 3/7/0226 for 3/7/2026); with it that account passes (1 member, 1 account, 1 New Sale). Still pending: 30 accounts whose payment is not a whole number of months at the program's rate (14 programs; patterns: ₱210 on D-250 FG / D-270 (300) / D-280 / D-410, ₱350 steps on DPB-420, ₱300 on the 350 programs), awaiting the owner's rule, and 1 account with invalid coverage (M2-COLL row 87).
- **Done on production (owner, October 9):** DDO 2-NS row 206 imported (no old-sheet collections for that person; checked).
- **The two pending New Sales (owner, October 9):** M1-NS 423 (TORIL) and M3-NS 440 (CALINAN), both D-350 (5Y), each had one ₱300 receipt among ₱350 payments. Those receipts (M1-COLL 8871, Aug 24; M3-COLL 12292, Jul 16) are the members' **D-300 (BRACKETING)** payments filed under the wrong program: each fills the one missing month of that account. PH-72171669 and PH-74499089 (CALINAN) are one person (D-300 (NEW BRACKETING), forfeited, and D-300 (BRACKETING), active). `scripts/fix-legacy-receipts.mjs` (config `config/legacy-receipt-fixes.json`; dry run rolls back, `--apply`) merges that member, adds the two receipts to D-300 (BRACKETING) with the importer's IDs, renumbers those accounts in OR-date order (TORIL: Aug = NOP 9, Sep = NOP 10; CALINAN: Jul = NOP 4, Aug–Sep = NOP 5–6) and recalculates their status; on production it removes the two rows from Legacy Pending COLL. The importer skips those rows (`leaveOut` in `config/legacy-migration-map.json`) and sends the CALINAN rows to the kept member (`members`). Staging: applied; the importer then writes 0 new members, 2 accounts, 2 New Sales, 10 collections.
- **Done on production (owner, October 9):** the merge, the two ₱300 receipts and the D-350 (5Y) import; Legacy Pending NS is empty.
- **Duplicate application deleted (owner):** PH-72171669's D-300 (NEW BRACKETING) (web app, March 27, 2026, ₱300) was the same application as the old sheet's D-350 (5Y) of that day (the member took D-350 (5Y) instead); `deleteAccounts` in `config/legacy-receipt-fixes.json` removes the account, its New Sale and that sale's 2 beneficiaries (Audit Log keeps the rows). The member keeps D-300 (BRACKETING) and D-350 (5Y).
- **Misfiled receipts (owner, October 9):** `scripts/check-pending-receipts.mjs` (read-only; `--json=FILE` writes suggestions) found that 22 of the 29 odd pending payments are payments of the **same member's other program** filed under the wrong one, each filling a missing month (₱210 / ₱420 on D-210 HG, ₱350 on DPB-350, ₱230 on D-230, ₱320 on D-320, ₱300 / ₱900 on D-300 (BRACKETING), ₱190 on D-190, ₱360 on D-180, ₱1,050 on D-350). 21 are moved by `fix-legacy-receipts.mjs` (the two ₱420 D-210 HG receipts count as 2 months each, as written in the sheet; existing payments keep their months when renumbered, and a receipt older than every payment on the account is numbered before them, e.g. NOP 59 when the account starts at NOP 60, as the sheet wrote; the first production dry run showed it pushing them a month later for M3-COLL 1569, DAVNOR-COLL 823 and SDS-COLL 565, fixed before applying); M1-COLL 6636 (OR 8324 B) is DPB-350 (owner). The owner also found OR 21866 C of the same member already in the database on a D-350 account created only by that receipt: `moves` in `config/legacy-receipt-fixes.json` puts it on DPB-350 (8324 B = NOP 10 June, 21866 C = NOP 12 August, as written in the sheet) and the empty D-350 account (no New Sale) is deleted. Staging: applied; the importer then has 9 accounts left, nothing else to write.
- **Last pending accounts settled (owner, October 9):** four more receipts fit another program of the same member once NOPs are read instead of calendar months (members often pay a month late): 20883 C → D-270 (300) NOP 35, 15123 N → D-350 (5Y) NOP 8–9, 4767 → D-210 HG NOP 28, 180 S → D-180 NOP 82; 12131 B → D-210 HG NOP 22 (July), so 12276 B is August and 14295 B September (owner); OR 24915 N, the only payment of a DPB-350 account (stored as NOP 1050 from the 1939 DOI), is a D-350 (5Y) payment (NOP 10), and that account is deleted. The importer takes owner corrections per row (`amounts`, `programs` in `config/legacy-migration-map.json`): 20726 C is ₱230, 00609T is D-300 (BRACKETING) (forfeited). Bug fixed: an OR date typed "6/2/0202" was read as "202-06-02" and passed the date check; dates now need a 4-digit year. Staging: every pending account passes (3 new members, 3 accounts, 20 collections).
- **To do (owner):** `npm run prod -- node scripts/fix-legacy-receipts.mjs` then `--apply`; then the importer `--pending --repair --fix-nop-typos` (expect 3 members, 3 accounts, 20 collections) then `--apply --skip-invalid`. Legacy Pending NS and COLL are then empty, and Google Sheets can be removed from the system.
- **To do (owner):** `npm run prod -- node scripts/fix-legacy-receipts.mjs` (dry run: 1 account delete, 21 receipts) then `--apply` (removes those rows from Legacy Pending COLL).

**Old workbook, second download (October 8, 2026).** The owner added a new download of the old Google Sheet, `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx` (same per-territory NS/COLL tabs, plus Expenses Entry and Adjustments 2026); staff still enter rows there (latest October 8).
- **Done:** checked how it matches the database. The Form tabs only grow at the bottom: 62,881 of 62,890 rows still map to their October 1 record (same tab, row and timestamp), so `migrate-legacy-members.mjs` now takes `--source-title=Data-Base-Old` to read the new file as the old one: rows already imported keep their IDs and are skipped. New payments on an account already in the database are checked against the payments the database holds for it (held back and listed when they leave a gap or overlap), and a row whose receipt (OR number digits, OR date, amount) is already posted, because it was encoded in this system too, is skipped. Staging dry run: 72 members, 79 accounts, 55 New Sales, 1,046 collections (1,022 on existing accounts); 26 held back; 9 rows whose row now holds a different record and 5 rows changed since October 1 are left for review.
- **Adjustments 2026:** the tick (column K) means the adjustment was already done in the old sheet (owner, October 8). All 832 ticked requests were submitted before the October 1 export, so they are already in the imported data (only 5 imported collections differ from the sheet). 237 requests are not ticked (never done; 7 submitted after October 1): staff should handle them in this system. The entry timestamps in the tab are dates only, so a request identifies its record by date, name and branch.
- **Split members:** a spelling difference between a member's New Sale and collections (e.g. "Potenciando" / "Potenciado") made the October 1 import create two members, each with an account. `scripts/find-name-variants.mjs` (read-only) lists members with an account in the same program and branch whose names differ by at most 2 letters, into `legacy-data/name-variants-review.csv` with a MERGE column for the owner. Staging: 49 pairs (31 with no New Sale, 10 with one, 8 with both).
- **Same-person merges (October 8):** the owner chose 34 of the 49 pairs (all but #9, #10, #11, #21, #23, #27, #28, #42–#49, likely different people), listed in `config/name-merges.json` by enrollment ID. `scripts/merge-name-variants.mjs` (dry run; `--apply`) moves the other account's collections to the kept one (the one with the New Sale, else more collections) only when the combined payments form one history; NOPs written twice by mistake are renumbered in OR-date order when no two payments fall in the same month (the October 4 rule), while payments in the same month in two or more months mean two people and the pair is left. The duplicate account is deleted, and the duplicate member when nothing else is theirs; `useOtherName` keeps the other spelling (Kisha Karen **Potenciado**, owner). Staging: 27 merged (e.g. Potenciado: 9 collections, NOP 6–14), 7 left as two people (Beltran, Pastor, Digal/Digao, Ortiga, Tabaranza, Juab, Tolosa).
- **Decided (owner, October 9):** the 7 pairs the merge left as they were are different people: Joey / Joel G. Beltran Jr., Jilbert / Jobert Ortiga, Ferly / Felyn Tabaranza, Teresita / Teresa Juab (both paying in the same months), Rosita / Rolita Pastor, Danny Digao / Danny B. Digal (Digao has two programs, each with its own MAS) and Rona / Rowena Tolosa (Fuentes, P. / Garcia, L.). They and the 15 pairs not chosen on October 8 are listed as `notSamePerson` in `config/name-merges.json` (22 pairs), which `find-name-variants.mjs` now leaves out; 27 pairs stay to merge (all merged on staging).
- **To do (owner):** `npm run prod -- node scripts/merge-name-variants.mjs` (dry run) then `--apply`; then `npm run prod -- node scripts/find-name-variants.mjs` for pairs production has that staging lacks (names in `legacy-data/name-variants-review.csv`, for the owner).
- `npm run prod` now quotes arguments with spaces when it runs npm/npx (a file name such as "2026 DATABASE (NS + COLL).xlsx" was split before).
- **To do:** owner runs the merges on production (`npm run prod -- node scripts/merge-name-variants.mjs`, then `--apply`); the import dry run on production (`npm run prod -- npx tsx --tsconfig tsconfig.json scripts/migrate-legacy-members.mjs "legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx" --source-title=Data-Base-Old --fix-nop-typos --repair`), then `--apply --skip-invalid`, and again once staff stop using the sheet; runs `find-name-variants.mjs` on production and marks the pairs; then a merge of the confirmed pairs (to build).

## Remittance approval flow (2026-10-04)

- Entry Clerks no longer build remittance slips or approve cash. Saved New Sales and Collections appear in My Entries as Outstanding; once their receipt photos are attached (on the Collections form, in My Entries, or in Today's Entries) they go to Pending Approval on their own (`submitReadyEntries` in `lib/remittance-workflow.ts`): a Collections batch as one slip when every Collection in it has a photo, New Sales one by one. The slip is created by "System", expects exactly the company share (plus any Fidelity), and is dated the batch's Date Remitted at the encoding time (23:59 when encoded on another day).
- Approvers (administrators) approve or reject one slip, the selected slips, or all. A rejected slip's entries become Returned to the clerk with the reason (shown in My Entries); the clerk fixes them and resubmits (replacing the photo also resubmits).
- Remittances has Dashboard, Pending Approval and Reports. An Entry Clerk sees only what they encoded; approvers see everyone, filter by Entry Clerk and search. Cash received in full (immediate approval) is for approvers only and is gone from the Collections form.

## Reports tabs and collections photo (2026-10-04)

- Reports is one page with Daily, Weekly, Monthly, and Yearly tabs (`/reports?tab=…`), like Remittances; the old per-period addresses redirect. Report Review uses the same tabs.
- The Collections form no longer offers Cash received in full; its receipt photos (required since 2026-10-14) send the batch to Pending Approval right after saving.

## Rules still requiring business decisions

Further business decisions remain for complete transfer/history workflows, special incentive cases, detailed role permissions, attendance policy changes, dashboard KPIs, and future report layouts. The current defaults and remittance formula are described in the implementation document. Use the confirmed whole-installment payment rule and MAM meanings above rather than treating them as unresolved. Existing code describes current behavior but does not establish an unconfirmed business policy.

## Finance implementation

Finance now uses persistent `Expenses` and `Cash Transactions` sheets rather than browser-only page state. Expenses record a stable ID, date, category, description, amount, payee, payment source, branch, payment method, references, receipt number, status, remarks, timestamps, verified encoder identity, and void history. Posted expenses automatically appear as cash-ledger outflows.

The consolidated cash ledger combines approved physical Remittances as inflows, posted Expenses as outflows, and separately encoded manual cash adjustments. Manual entries include direction, category, cash account, branch, references, status, encoder identity, and void history. Users should not duplicate approved Remittances or Expenses as manual entries. Financial entries are voided with a reason rather than deleted; void permission currently follows the existing manage-users permission until a dedicated finance permission is defined.

Migration: `npm run sheets:finance -- --apply`. The live workbook was migrated on 2026-09-26.

## Branding, login, and interface updates

The official `icons/dayong_logo.png` artwork is used in the sidebar, login screen, and browser-tab icon. The login page has a dedicated full-screen shell and never renders the application navigation. It presents the supplied Vision, Mission, formatted workplace Prayer, and official Facebook link while keeping the working username/password authentication flow. Google login and password reset were not added because no corresponding authentication backend exists.

Attendance now uses the violet/lime visual system with Philippine Standard Time, live session duration, progress and attendance metrics, and actual clock-in/out activity. MAM uses the same visual language while preserving month-range controls, status synchronization, filtering, horizontal comparison, print/CSV actions, grouped MAS totals, projections, and account details.

The shared application shell is mobile-first: the navigation drawer remains mounted on compact screens, uses a labeled touch target and safe-area spacing, and becomes persistent on wider screens. Page headers, cards, forms, tables, action groups, and the login page use the Dayong palette with flexible wrapping and horizontal scrolling only for data tables that require it. Interactive targets use larger shared button sizes for touch use.

Production authentication now validates required server environment variables lazily, normalizes quoted or escaped Google private keys, and returns actionable configuration errors instead of an HTML failure. Vercel must define `AUTH_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `GOOGLE_SHEET_ID` in the Production environment and redeploy after changes.

## Role-based navigation

Login sessions now contain stable role IDs and role names. The sidebar is generated from role access, and the proxy rejects direct navigation to pages outside the current role workspace. The live roles are Administrator, HR Officer, CEO, President, Entry Clerk, IT Clerk, and MAS; the future Finance role is supported but not present in the live sheet. Existing server action permissions remain in force. See [role-based access](access-control.md) for the matrix and explicit data-scope limitations.

## CRUD and record lifecycle

Master-data CRUD is available for Branches, Programs, Members, Employees, and User Accounts. Deletes are relationship-aware: referenced branches, programs, members, and employees must be made inactive or have their dependent account resolved rather than being removed. Members are created through New Sales because registration also creates the required sale and enrollment records. Financial, collection, remittance, attendance, and leave records retain their void, approval, rejection, review, or status workflows instead of destructive deletion. See [CRUD and record lifecycle](crud-policy.md).

## Operational reports

Daily, weekly, monthly, and yearly reports are generated from the source Sales, Collections, Remittances, Expenses, and Cash Transactions sheets. They can be filtered by branch, program, and accountable MAS/Collector, printed, or exported as an Excel-compatible CSV. Reports do not duplicate operational records into separate report sheets. See [operational reports](reports.md) for the calculation rules and current data-source limitations.

## Role-based dashboard

The main dashboard is separate from formal Reports and renders a workspace based on the signed-in user's role. Administrators see system configuration and attention items; CEO/President see company performance; Finance sees cash and remittance control; HR sees personnel and branch staffing; Entry Clerks see their daily encoding and quick actions; IT sees accounts and configuration activity; and MAS users see only report totals associated with their accountable name plus their assigned member programs. Dashboard financial figures reuse the same calculation service as Reports so summary and drill-down totals stay consistent.

Program master data now stores whether a registration fee is required, its amount, and an optional pay-the-balance total. The fields are stored in `Programs!K:M` so the established encoder identity columns in G:J retain their positions. New Sales reads registration defaults from the selected Program, labels the enrollment free-text field as Notes, and presents a per-sale review before writing. Collections starts from the full monthly amount but permits an edited amount only when the server can verify that it exactly settles the configured remaining program balance; a paid-off account receives the `Paid` status.

Branch selectors display both branch and territory because branch names are not globally unique. Member directory rows summarize the member's assigned branches, and the View action toggles the detail panel. User account creation uses one searchable employee control. Remittance receiver identity defaults to the signed-in username, and mouse-wheel changes are disabled on financial and NOP number inputs.

HR and administrators declare non-working days from the Holiday & Non-working Day Calendar on Attendance Review. Each declaration needs a reason and the affected branches (All branches, or chosen branches), may be for a past or future Monday-to-Saturday date, and can be updated or removed. It is stored as an encoded Attendance control record (employee `SYSTEM`, status `Non-working Day`; the branch column holds `All branches` or the branch IDs joined by `, `). It blocks clocking for employees whose primary branch is covered and cancels clock-ins already recorded at those branches, keeping the original times in the notes; removing the declaration does not restore them.

Holidays live in the `Holidays` sheet (created on first use). Administrators can add the usual Philippine holidays for a year in one click (lunar and Islamic dates come from built-in tables and are marked as estimates), then edit or remove them. A holiday never closes attendance by itself. Every user sees the same calendar, read-only, on My Attendance, with closures that include their branch highlighted.

Google Sheets role IDs use readable stable keys such as `ROLE-ADMINISTRATOR` and `ROLE-FINANCE`; User Roles references were migrated in the same batch. Transaction and relationship sheets use uniform readable prefixes (`EBA`, `ENR`, `SAL`, `REM`, `RCL`, `COL`, `INC`, `ATT`, `LR`, `EXP`, and `CASH`), with their foreign-key references migrated together. New records use timestamp-based readable IDs to avoid returning to UUID-only values.

## Administration and audit history

Administrators can manage the Roles sheet through Role Management. Role IDs are generated stable primary keys, role names must be unique, assigned roles cannot be deleted, and the live workbook includes the Finance role. The roles migration repairs later duplicate IDs while keeping existing User Roles assignments attached to the first occurrence, avoiding accidental multi-role access from a reused key.

Entry History gives administrators a cross-module view of New Sales, Collections, Remittances, Expenses, Cash Transactions, Members, enrollments, Employees, Branches, and Programs with record ID, information, encoder username, and encoded timestamp. Historical rows without verified encoder metadata remain identified as historical rather than being attributed by guesswork.

All signed-in roles can view Programs and Branches as reference data. Only Administrators or accounts with manage-users permission can create, edit, or delete those records. Employee branch assignment supports selecting every branch or all branches within a territory. Expandable directory lists keep only one record open at a time.

New Sales and Collections use searchable Branch and accountable-employee controls. The employee choices are limited to active employees assigned to the selected Branch, and the same relationship is checked again by the save API. Birthdates accept direct `YYYY-MM-DD` entry so old years can be entered without scrolling through a calendar.

New Sales persists beneficiaries in the dedicated `Beneficiaries` table. Every beneficiary has a readable primary key and foreign keys to both the Member and Sale, followed by encoder tracking fields. Registration-required and registration-amount values are controlled by Program master data: selecting a Program fills those fields and the initial Amount Paid, while Amount Paid remains editable.

Program controls in New Sales and Collections are searchable by program code or name; Collections displays the program code while retaining the program ID as its relationship key. Remittance is calculated from the configured incentive and markup, plus any collection amount above the covered monthly dues. Cash accountability and physical Remittance approval use this calculated remittance amount. Collections offers immediate approval when the entered cash matches exactly, restricted to an Administrator who also has the Entry Clerk role.

User Account editing supports accounts whose original role exists only in `Users.role_id`, synchronizes the selected roles into `User Roles`, and displays validation errors next to the edit form.

The sidebar has an active-role selector for users with multiple assigned roles. Each role renders a finalized workspace while the server continues to authorize against all assigned roles. Desktop users can minimize the sidebar to icons or maximize it, and users can choose a Pill or Line active-page indicator. These preferences and the last active role persist in browser storage.

Every signed-in employee can switch to the MAS sidebar workspace without writing a redundant MAS assignment to `User Roles`. The minimize/maximize control sits beside the active-role selector. Administrator, HR, and Finance workspaces include Employee Attendance Tracking, with employee and date-range filters plus totals and daily detail for hours, overtime, lateness, undertime, attendance status, leave, and remarks.

The specification's statements about previously completed features or builds must be checked when relevant; they are not evidence that every described operation is currently supported.

## Color palette and themes

The palette comes from the company seal and is defined once in `app/globals.css`:

- **Brand purple** (seal lettering): primary actions, links, focus.
- **Lime and moss** (seal ring): the active sidebar item, success.
- **Sun gold**: warnings and items needing attention.
- **Navy, teal, red, orange** (the five figures): categorical accents on metric tiles; red also means danger.
- **Neutrals** carry most of the interface, so accents keep their meaning. Status is shown with `StatusBadge` chips and `MetricTile` accents; color always accompanies text or an icon.

Cards, the sidebar, the floating rounded top bar, and page headers are frosted glass (translucent fill, heavy backdrop blur, a light gradient edge, soft shadow) over a brand gradient mesh: pastel in light mode, glowing on near-black in dark mode. The sidebar follows the theme. Declare only the unprefixed `backdrop-filter` in CSS; the optimizer collapses a var()-based prefixed pair into `-webkit-backdrop-filter`, which Chromium ignores. Glass falls back to solid surfaces when blur is unsupported or the user prefers reduced transparency. Users choose **Light, Dark, or System** in the sidebar, the phone top bar, or Settings → Workspace preferences; the choice is stored per browser and applied before first paint. Every color is a CSS variable redefined under `.dark` (soft dark greys, never pure black), so page-level `violet-*`/`purple-*` utilities adapt automatically. Printed reports always use the light theme. Use `.brand-panel` for a surface that must stay dark in both themes.

## Program age restrictions

Programs can be age-restricted (Programs N:P: `age_restricted`, `min_age`, `max_age`). When restricted, a minimum age is required and the maximum may be blank for no upper limit. New Sales rejects an enrollment when the member's age today is outside the range, using the stored birthdate for existing members. Rules live in `lib/program-age.ts`; headers were added with `npm run sheets:program-age`.

## Program categories and branch incentives (2026-10-02)

- Programs have a **category** (Programs S `category_id`) from the editable **Program Categories** sheet, seeded with Pay the Balance, Funeral Services and Cash Assistance. Administrators and IT add, rename, deactivate or delete categories on the Programs page; a category in use cannot be deleted, only made inactive.
- Program Incentives M `branch_id` makes a tier branch-specific. Blank tiers are the program's **base rates** for every branch. A branch with its own tiers for a role uses only those for that role there (`tiersForBranch` in `lib/remittance.ts`); Collections, the New Sale incentive (month-1 tier), and both previews apply it. Each program still needs base tiers.
- Migration: `npm run sheets:program-categories -- --apply` (applied 2026-10-02).

## Attendance corrections

### Tracking and report readability (2026-10-06)

- Attendance Tracking now recognizes recorded **Day Off** as its own category, with a daily count, filter and employee list, plus a **Days off** history total. It is separate from Absent, AWOL and leave, including on past dates and declared branch closures. Day offs continue to be assigned in Attendance Review.
- Entry Clerk report sheets and MAS summaries now use theme-aware text and surfaces. Colored summary headings have explicit contrasting text; printed sheets stay dark text on white even when the app is in dark mode.
- Flexible programs ask whether each monthly payment has a maximum. **No maximum** saves null; **Yes** requires a maximum at least equal to the monthly minimum. Multi-month receipts may pay up to maximum × covered months, subject to the remaining total payable. First-month New Sales follow the limit; registration fees are separate. Existing history remains readable. Source: `lib/program-payment-limit.mjs`; migration: `0009_program_monthly_maximum`, required before deployment.

## Incentives by who collected; non-commissionable periods (2026-10-10)

- **Owner:** MAS collects → MAS incentive; Collector collects → Collector incentive; DTO (Direct to Office) → no incentive, the remittance is the gross. Each incentive period can be marked non-commissionable: only the Collector earns (default 10%, editable).
- **Done:** DTO used the MAS tiers before; `calculateRemittance` now takes role "DTO" (no tier needed, incentive 0) and gives the MAS nothing in a non-commissionable period (`incentiveRoleFor` in `lib/account-rules.ts` and the Collections page). Migration `0018_non_commissionable_periods` adds `program_incentives.non_commissionable`; Programs → incentive periods has the checkbox (sets MAS 0 and Collector 10%, MAS locked), saved on both role tiers of the period and shown on the program card. Tests: unit tests in `scripts/test-remittance.mjs`, and a DTO batch expects the gross as its turnover total. Saved entries keep the incentive they were saved with; only new saves use the rules.
- **To do (owner):** `npm run prod -- npm run db:migrate` (0017 and 0018) before deploying; then tick the non-commissionable periods in Programs.

## Program edits that disappear (2026-10-10)

- **Owner:** a program edit is sometimes gone when checked later. The save itself is correct (one transaction; the edit form loads and sends every setting; opening Edit and saving unchanged leaves all 56 staging programs identical), and no script rewrites existing programs. Likely cause: a lost update. Programs → Edit sends every setting and tier, so a form opened earlier (by another administrator, or another tab) writes its older values back over a newer save.
- **Done:** the form sends a snapshot of the program as opened (`lib/program-snapshot.ts`); `PUT /api/programs` refuses the save (409) if the program changed since, asking to reopen it. Test added. `scripts/program-history.mjs` (read-only) lists program changes from the Audit Log with who and when, and flags settings set back by someone else.
- **Production history (October 10, 30 days):** 33 program changes, none set back by someone else, so no lost update in that window. Jo-Ann Bautista saved some programs several times within minutes rewriting only the incentive periods (180: 3 saves; 230: 5 saves on October 8), which suggests the periods are what seemed not to stick. `program-history.mjs` now prints, for each period save, the rates before and the rates saved (reconstructed from the Audit Log). Also seen: on October 7 Jo-Ann renamed D-290 (DP-0046) to DSP-290 (the second DSP-290 fixed on October 9), and on October 8 several codes became bare numbers with the D- name moved to the name field (code "230", name "D-230"; also 190, 180, 290, 300, 280).
- **Program 230 (production):** all five period saves on October 8 wrote the same rates (months 13–180: MAS 12%, Collector 10%; BR-0008 MAS 15%, Collector 10%), so nothing was lost: the form reopened the periods in months (13–180) although they were entered in years, so the entry looked changed. Two fixes: "from Year N" now starts at month 12(N−1)+1 (it was N × 12, leaving 11 months without a rate), and periods on whole years reopen in years. Also found: 230 has no rate for months 1–12, so a 230 collection in its first year would be refused.
- **Production check (October 10):** months 2–12 have no rate on 180, 190, 230, 280, 290 and 300, and months 7–12 on D-210 HG (2,425 accounts). Owner: 180–300 are old programs no longer sold, so only their later months have rates; that is intended. `check-incentive-periods.mjs` now also counts open accounts whose next payment falls in a gap (those collections would be refused), which is what needs a rate.
- **To do (owner):** run the check again; set a rate in Programs → Edit only where open accounts are waiting (likely D-210 HG months 7–12).

## Google Sheets disconnected (2026-10-09)

- **Done:** the app no longer talks to Google. `lib/google-sheets.ts` answers every Sheets-style call from the database (it already did for every app tab since October 5; only the Legacy Pending tabs were still on Google, read by the old-data scripts). Sign-in no longer requires `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` or `GOOGLE_SHEET_ID`; the Google line left IT → System Health; `/api/google-sheets/test` is removed. The spreadsheet stays in Google Drive as an archive (data before October 5, Legacy Pending / Legacy Repairs); the old-data scripts in `scripts/` still read it with the `GOOGLE_*` values in `.env.local`.
- **Found and fixed:** Company Targets (executive dashboard) could never be saved: the code wrote to a Google tab that did not exist. Migration `0017_company_targets` adds the table; saving, updating and reading a target tested on staging.
- **Exceptions (October 9):** new category **Imported receipts sharing a number**, always listed (old data included): imported collections and New Sales flagged as reusing an OR or application number already on another entry and not relabelled "(duplicated)" on October 7, each naming the other entry, with the Correct form (staging: 54 collections, 58 New Sales).
- **Exceptions counts explained (October 10, production with imported records):** Amounts 14,389 were mostly valid D-210 HG payments (₱210 on a flexible program, ₱150 minimum): Exceptions read Programs A:U and never saw the flexible column, so it judged them against ₱150 as a fixed rate. Fixed (`PROGRAMS_RANGE` A:W; flexible collections flagged only below the minimum or above a set maximum): staging 14,865 → 728. Of those, 478 are DSP-290 New Sales of ₱500 against a fixed ₱290 (owner: DSP-290 has a ₱500 registration fee, but the program is set without one; set it in Programs), 142 are D-250 FG payments recorded as one month but paying ₱490–₱500 (real data to check). Members with missing details (8,417): 8,346 are members known only from old collections (no New Sale anywhere, so no birthdate, contact or address on file).
- **To do (owner), in this order:** `npm run prod -- npm run db:migrate` (0017), then push/deploy; afterwards remove the three `GOOGLE_*` variables from Vercel and redeploy.

## Batch from Clearing (2026-10-09)

- **Done (owner asked: less scrolling when encoding):** New Sales lists the receipt and program fields first (A. Application and Program), folds finished sales into a one-line summary, and ends in a save bar fixed to the bottom of the screen with the totals, control total and Save. Collections entries are compact (Program; Month from/to; Amount · OR Number · OR Date on one row; status, NOP and remittance on one line) with a save bar fixed to the bottom of the entries panel. Enter moves to the next field on both (`lib/enter-to-next.ts`). Layout only; rules unchanged.
- **Done (owner):** the Application Date is also the date enrolled (DOI); the separate Date Enrolled field is gone and New Sales save the application date as the DOI. The save bars and the review before saving show the **Total amount collected** in large type with the total remittance.
- **Done (owner):** Collections take **Months paid** (a quantity) instead of Month from / Month to; the first month is the account's next unpaid month, the last month, NOP and amount follow. The Current Entry card in the history panel is pinned to its bottom.

- **Done:** Clearing lines show their progress instead of staying "Waiting for encoding": Waiting for encoding → Waiting for receipt → For approval → Approved (or Returned), with entry counts. A line leaves the page after 11:59 PM only once Approved (owner); unfinished earlier lines stay. No migration (worked out from the entries).

- **Done:** New Sales and Collections pick the MAS from Clearing (**From Clearing**); Branch, MAS and Date Remitted are filled in from the clearing. Fixes MAS listed in Clearing but not detected: the check now ignores branch case and spaces, accepts a clearing still waiting for encoding made after the Date Remitted, resolves two employees with the same name to the cleared one, and its message names where and when the person is cleared. No migration.

### Bulk marking and No attendance needed (2026-10-09)

- **Done:** the daily board has tick boxes on rows without a clock-in, a tick box per section heading, and **Select all** for everyone shown; the selected employees are marked together as Absent, AWOL, Day Off or **No attendance needed** with an optional note. Clocked-in, on-leave and closed-branch employees are skipped and named in the result.
- **Done:** new attendance status `Not Required` (shown as "No attendance needed") for employees who need not clock in, such as MAS. It is not an absence for payroll, history or the end-of-day system absence, and a clock-in replaces it. Attendance Review has a matching button. No database migration (the status column is text).
- **Done:** Attendance Review has tick boxes, Select all (respects the branch and role filters, so all MAS can be marked in one go) and Mark selected as; each row's four mark buttons became one **Mark as...** dropdown. The daily board always shows its selection bar to those who may mark.
- **To do (if wanted):** a permanent per-employee setting ("never requires attendance") so MAS do not have to be marked each day; today it is a per-day mark.

### OR numbers must end with a letter (2026-10-12)

- **Owner:** the encoder must put one letter at the end of the OR number.
- **Done:** Collections (form and save) and corrections of an OR number accept only digits followed by one letter (`12345 C` / `12345C`; the letter saved in capitals). New Sales have no OR number (they use the application number). Tested.

### Penalty in the clerk report (2026-10-12)

- **Owner:** the report has no penalty; add it.
- **Done:** New Sales and Collections lines have a Penalty column; the cash summary has a Penalty line after Fidelity Bond, counted in Total Cash In and carried into the next Cash Beg. Tested.

### Every entry filters (2026-10-14)

- **Owner:** in Audits, Every entry needs filters: New Sales only, Collections only, remitted, returned, missing, search for OR numbers, MAS, program.
- **Done:** the report's Every entry list (Audits, Report Review, Reports) has a filter bar: All / New Sales only / Collections only; status (Remitted, Returned, Missing receipt photo); search by OR or application number; MAS and program (choices from the period's entries); Clear filters. The heading shows how many match (e.g. 12 of 80). Filters work on the entries already loaded (first 1,000) and are hidden when printing.
- **To do:** nothing.

### Member transfer to a MAS from another branch (2026-10-14)

- **Owner:** transferring members to another MAS should allow a MAS from another branch; asked, the owner chose to decide per transfer whether the accounts keep their branch or move.
- **Done:** single (Members) and bulk (Employees → Transfer members) transfers list every active employee with their branches. For accounts in a branch the new MAS is not assigned to, the form requires: **Keep** (the account stays; the MAS is assigned to that branch, so Clearing and Collections work) or **Move** (the account changes to one of the MAS's branches; past entries stay under the old one; the transfer reason notes the branch change). Bulk transfers no longer skip accounts outside the new MAS's branches. One transaction; the database relinks branch and MAS IDs. Tested (keep, move, missing choice, bulk).

### Attendance sheet for Finance (2026-10-14)

- **Owner:** an attendance sheet for each employee that Finance can check for a date range, overall and with summaries; important for salaries.
- **Done:** Attendance Tracking → **Attendance sheet** tab (Finance, HR, management): payroll cut-off quick ranges; a summary table of every employee (working days, present, days payable = present + approved leave as payroll counts, late, undertime, overtime, regular / total hours, leave, day off / not required, absent with system absences, AWOL, no record, no time-out, attendance rate) with totals and search; click an employee for the day-by-day sheet (every date, including days with nothing recorded), with only-days-to-check, print and CSV (`lib/attendance-sheet.ts`, `/api/attendance-sheet`, `app/attendance-tracking/attendance-sheet.tsx`). Uses the same records as payroll. Tested.
- **Production preview (October 1–13):** 162 employees listed; most are MAS marked No attendance needed or absent by the system, so search by role (e.g. Entry Clerk) for office staff.

### Attendance sheet in the paper format; paper sheet October 1–15 imported (2026-10-15)

- **Owner:** use the format of the office's paper attendance sheet (two photos: key, month and year, one column per date with its weekday, red Sundays, time in per day, codes, total days, rate), and put that sheet's October 1–15 attendance on each person; where the system already has that person's attendance for the day, keep the system's.
- **Done:** the Attendance sheet tab opens on **Sheet**, the grid in the paper format (Summary is the earlier table): key (L leave, P present, A absent, LA late, RD rest day, NR not required, ND no record), the time in for days worked (late in red on yellow), red Sunday and non-working-day columns, Total Days (present + approved leave, as payroll), and the rate (fixed monthly or per day) for those who can open Payroll; click a name for the day-by-day sheet; prints landscape; CSV in the same layout (`gridCell` in `lib/attendance-sheet.ts`). A Present day with no times (paper P) now counts present on the sheet, as payroll already counted it; paper time-ins are not flagged for a missing time-out (`PAPER_SHEET_NOTE`). Tested.
- **Import:** `scripts/import-paper-attendance-20261015.mjs` (photos typed in; matched by employee ID with a name check). Times become Present with that time in (late after the 08:20 grace, no time out), P Present, LEAVE approved Leave, A Absent, RD Day Off. A day the system already has (clock-in, leave or management mark) is kept and listed; a system absence (no clock-in) is replaced by the paper entry. ND, NA and blank cells are not written.
- **In progress:** the owner runs the dry run, then `--apply`, on production (`npm run prod -- node scripts/import-paper-attendance-20261015.mjs`).
- **To do / open:** GULTIANO, MARCLEONITZ (P on October 12) is not a registered employee, so skipped. Meaning of **NA** (Abesia October 13; Pacios and Balcos October 10) to confirm; skipped until then. The sheet header says 2016, but its weekdays are October 2026's.

### PH-93455604: programs not shown in Collections (2026-10-15)

- **Owner:** the member has 2 programs, but Collections does not show them.
- **Finding (staging copy; production to confirm):** both accounts are under MAS EDELYN B. TIZON, but in different branches: D-210 HG in MATINA, D-300 (Bracketing) in TORIL (same DOI, 8 collections each). A Collections batch lists only the accounts of its own branch and MAS (and Active status), so each batch shows one program and never both.
- **Tool:** `scripts/member-accounts.mjs <member number>` (read-only; account structure only, no personal details), on production with `npm run prod --`.
- **To decide:** if both accounts belong to one branch, correct the other account's branch; or let Collections list every account of the MAS whatever its branch.

### Finance-Auditor role: ticked pages not all seen (2026-10-15)

- **Owner:** the pages ticked for the Finance-Auditor role in Roles are not all seen in the actual system.
- **Cause:** the sidebar and dashboard know only the built-in role names, so Finance-Auditor got the MAS layout (its pages squeezed into MAS sections) and the MAS dashboard; and several pages read their data by role name (Finance), so a ticked page opened empty or refused: Attendance Tracking and its sheet, Audit Log, Fidelity monitoring, Exceptions, the Gross Sales breakdown.
- **Done:** Finance-named roles (`isFinanceFamilyRole`) use the Finance layout and dashboard and read what Finance reads; other custom roles are grouped like the Administrator sidebar; ticked pages show their data (`pageTicked`). Changing money stays with Finance and Administrators. Tested (sidebar with every ticked page, dashboard, access checks).
- **To confirm:** the production Finance-Auditor page list was not read (production reads are blocked here); if a ticked page still does not show, name it. A change in Roles reaches a signed-in user within 5 minutes (session recheck) or at the next sign-in.

### Cards turning white when a receipt photo is attached (2026-10-15)

- **Owner:** when the Entry Clerk attaches a picture, the card turns all white (screenshot: the Collections entry panel shows the photo button and the save bar at its top, blank below).
- **Cause (found from the screenshot):** the photo picker's file input was visually hidden (`sr-only`) but still focusable. When the file picker closed, the browser focused it and scrolled the form card (`overflow-hidden`, which can still be scrolled by the browser) to show it, so the card's content slid up and left white space below. Two earlier guesses (solid entry cards; removing the masked light-edge overlay from every card) did not fix it; they are kept, as they do no harm.
- **Done:** the input is `display: none` and a button opens it (`components/receipt-photos-picker.tsx`), as the My Entries photo button already did; the two Collections panels use `overflow-clip`, which cannot be scrolled at all. Build and tests checked; to confirm on a clerk's computer.

### No second batch while one is waiting (2026-10-16)

- **Owner:** while a batch is pending approval the encoder can encode the same details again (double entries); do not allow it.
- **Done:** `waitingBatchProblem` (lib/clearing.ts) refuses a New Sales or Collections save for a person, branch and Date Remitted while a batch of that kind for them is Outstanding, Pending Approval or Returned, unless they were cleared again after it was encoded; DTO and imported entries excluded. Tested; build and all tests pass.

### Resubmitted batches lost incentives (2026-10-16)

- **Owner:** some resubmitted entries after 3 PM got no incentive; the rule: cleared before 3 PM keeps the incentive however late it is encoded. Fix it and the affected entries.
- **Cause:** a resubmitted batch gets a new slip whose cash-received time was searched again (latest clearing of the person before the encoding time); a later clearing (another handover after 3 PM, or the next day's) was taken.
- **Done:** `receivedAtOf` uses the clearing linked to the batch's earlier slip and never a time later than the returned slip; tested. `scripts/restore-resubmit-incentives.mjs` restores forfeited incentives on resubmitted entries whose cash was cleared by the deadline (current slip's line and expected amount follow; Record Corrections).
- **To do (owner):** `npm run prod -- npx tsx --tsconfig tsconfig.json scripts/restore-resubmit-incentives.mjs`, check the list, then `--apply`.

### Fidelity history: Returned and the real encoder (2026-10-16)

- **Owner:** why Rejected and Encoded by System in the Fidelity history; show Returned for returned batches, and the real encoder.
- **Cause:** contributions are remittance slips; a rejected (returned) slip keeps its Fidelity amount, and slips are created by System.
- **Done:** Rejected shows as Returned; Encoded by is the encoder of the slip's entries, else who received the Fidelity, else the slip's encoder unless System. Balances unchanged. Tested; build and all tests pass.

### Fidelity filters (2026-10-16)

- **Owner:** add filters in Fidelity: date, roles, status, etc.
- **Done:** Fidelity Monitoring filters by employee, branch, role, employment status, Fidelity status and balance (balances and history), and by date range, type and status (history), with period totals and Clear filters; `lib/fidelity.ts` adds each employee's branch and roles. Build and all tests pass.

### Forfeiture: 12 months for Pay the Balance, 6 for others (2026-10-16)

- **Owner:** Pay the Balance: up to and including 12 months, still not forfeited; others: up to and including 6 months.
- **Done:** `forfeitMonths` on accounts (`forfeitMonthsFor`: the Pay the Balance category `CAT-PAY-THE-BALANCE`, or a category named Pay the Balance, is 12; otherwise 6), used wherever statuses are worked out (account data, Edit / Corrections, program moves); Statement of Account footer. `scripts/recheck-forfeited-accounts.mjs` reopens Pay the Balance accounts forfeited only by the old 6-month timer. Tested; build and all tests pass.
- **Owner, same day:** accounts still showed Forfeited with the category set. Cause: a stored Forfeited always held. **Done:** on Pay the Balance programs it no longer holds; only the 12-month count decides. The recheck script now stores the worked-out status on every Pay the Balance account within 12 months. Tested.
- **To do (owner):** put the Pay the Balance programs in the Pay the Balance category (Programs; none are on staging); then run `npm run prod -- node scripts/recheck-forfeited-accounts.mjs`, and `--apply` if the list is right.

### Members → Transfer: per MAS or per program (2026-10-16)

- **Owner:** the Transfer button in Members should offer a choice: per MAS or per program.
- **Done:** the Transfer panel has To another MAS / To another program; the program move uses `transferProgramAccounts` for that one account (same-pay programs; merge into an existing account; incentives follow). Permission `canMovePrograms` (Administrators, IT with Edit / Corrections); `programTargets` lists the programs. Tested; build and all tests pass.

### Day Off locks the day's entries (2026-10-16)

- **Owner:** an employee marked Day Off must not encode, void or delete entries that day; entries encoded before the mark: keep them and block changes (owner's choice).
- **Done:** `refuseOnDayOff` (`lib/day-off.ts`) at the start of every entry-changing route (collections, sales, sale submissions, My Entries and batch edit, receipt photos, admin delete, report actions, Today's Entries corrections, expenses, remittances, clearing, Edit / Corrections, Exceptions, Audit Log corrections); the Day Off mark (Attendance Review and the daily board) notes how many New Sales and Collections were encoded that day before it. Tested; build and all tests pass.

### Edit and delete expenses on the report (2026-10-16)

- **Owner:** allow edit and delete of expenses in the report.
- **Done:** Reports → the Expenses/Other Cash Out section has Edit and Delete on each expense, as deposits have: `editExpense` / `deleteExpense` in `lib/finance-data.ts` (the clerk who recorded it, or an administrator; delete voids it with a reason), actions `edit-expense` / `delete-expense` in `/api/clerk-report`. Tested; build and all tests pass.

### Login reminders (2026-10-16)

- **Owner:** on the login page, remind when Caps Lock is on, when Num Lock is on, and any other warning.
- **Done:** warnings for Caps Lock on, Num Lock off (number pad not typing digits), password with a leading or trailing space, an Employee ID not in the company format, offline, cookies blocked; a note when Num Lock is on. They appear once the person types or clicks (browser limitation). Lint, type check and build pass.

### Edit / Corrections for IT and Administrators (2026-10-15)

- **Owner:** a section where IT and Admin can search Collections or New Sales and edit them even when remitted (clerks still type wrong numbers). Then: rename it Edit / Corrections and put every data correction there, organized: entry edits of all content (a clerk may choose the wrong program for a member with many), members from MAS to MAS, accounts from program to program. Then: when a program changes, the entries' incentives must follow, so reports are accurate.
- **Done:** page `/entry-corrections` renamed **Edit / Corrections**, with tabs Entries (search; full Edit; Delete for Administrators), Move between MAS, Move between programs, Other corrections (links). Full edit in `lib/entry-edit.ts`: collection account/program, OR number and date, amount, months, Date Remitted, with renumbering of the affected accounts checked by the account rules; New Sale program (with its account and collections), application and OR numbers, date, amount, method, Date Remitted, notes. Incentives and company shares are worked out again for every entry whose amount, NOPs or program changed (`repriceCollections`, `repriceSales`), also after Move between programs; remittance slips' expected amounts follow. IT may use the MAS and program transfers here. Tested (move to another program with renumbering and slip, share kept on a number fix, refused when payments do not fit, New Sale program change with its collections repriced, refused when the member already has the program; program transfer). Build and all tests pass.
- **Decisions:** a number or date fix keeps the remitted figures; an entry whose program has no incentive tiers keeps its figures and is reported; Delete stays Administrator-only.
- **Owner, 2026-10-16:** a program could not be moved when the member's account in the target program already had NOPs. **Done:** `mergeAccountInto` (lib/entry-edit.ts) merges the two accounts, every payment numbered one after another in OR-date order from the lowest NOP (months from the earlier DOI), checked by the account rules; used by Move between programs (accounts that paid the same month are no longer left) and by a New Sale's program edit (instead of refusing). Incentives are worked out again. Tested.
- **To do:** roles whose page access was configured in Roles need Edit / Corrections ticked; try an edit on a remitted entry on production and check its slip.

### Member split: CABUNAG (2026-10-14)

- **Owner:** PH-96073537 was two people merged by the old-sheet import (Cabunag, Fe Mamato and Cabunag, Fe Dhivenil; MARAGUSAN, D-210 HG); their paired same-day receipts are one each.
- **Done:** `scripts/split-member.mjs` with `config/member-splits.json`: dry run, then applied on production by the owner. FE MAMATO keeps PH-96073537 (NOPs 16–19 and 20); FE DHIVENIL is a new member with her own D-210 HG account from DOI 2024-07-01 (NOPs 18–21 and 22); the held-back October 7 receipts 25235 N / 25236 N were added; both accounts' statuses recalculated. Audit Log and Record Corrections keep every change.

### Receipt photos required on New Sales and Collections (2026-10-14)

- **Owner:** make the attachment required on New Sales and Collections; at least one, as many as needed.
- **Done:** both forms have **Receipt photos for this batch \*** (`components/receipt-photos-picker.tsx`): add several photos at once or one by one, thumbnails with remove; Save is refused until one is added (New Sales: the Entry Clerk's save only; a MAS submission has none, the clerk adds them when saving it). After the save every photo is attached to every entry of the batch, which sends a bank or e-wallet batch to Pending Approval; a photo that fails to upload is reported and can be added in My Entries. My Entries and Remittances show all of a batch's photos (before, only the latest per entry).
- **Note:** the check is on the forms; the server still accepts a save without photos (the photos are uploaded right after the save), and older entries without photos still get them in My Entries.

### Expenses on the report of the day recorded (2026-10-14)

- **Owner:** an expense whose date the clerk changes goes to that date's report; it should always be on today's report.
- **Done:** the clerk report places an expense by the day it was recorded (Expenses U encoded at, else N created, Manila), not the expense date typed; the row still shows the typed date. Finance's own Expenses pages are unchanged. Tested.

### Collector incentives; deposit remarks; Audits show present clerks (2026-10-14)

- **Owner:** in Collections, a Collector collecting as Collector gets no incentive; cash-flow remarks must have numbers (numbers only fine, letters only not); Audits should show only Entry Clerks who were present.
- **Collector incentives (no code change):** the calculation is right; most programs' Collector tiers are 0% for most months (e.g. D-250 FG 13–120, D-300 (Bracketing) 1–12), so a Collector batch earns nothing there. Owner: use each program's incentives as set; when Collected by is MAS, the MAS rate applies (already so). The Collector preset is only a default; the clerk picks MAS when the Collector collects his own members.
- **Done:** deposit remarks required and must contain a number (`depositRemarksProblem`, add and edit; the form says so). Audits list an Entry Clerk only when present (clocked in or marked Present) in the period, or who encoded something in it, or who already has an audit for it (production: October 13, 7 of 11 shown). Tested (remarks).

### Waiver judged on the OR date; drafts to set a batch aside (2026-10-14)

- **Owner:** still wrong: an OR dated September for August asked for a Waiver though the member was not two months late. Also: drafts, so a clerk can leave a batch for a moment and go on with other entries.
- **Cause:** the Waiver check also looked at today's state (August and September ended unpaid, the September payment not yet encoded), not only the state on the OR date.
- **Done:** suspension (and the Waiver) is judged on the OR date only (`validatePayment`; the Collections form compares the OR date with the account's suspension date); forfeiture is still judged today (a backdated OR cannot bypass it). New Sales and Collections: Drafts panel: **Set this batch aside** stores the open batch (labelled MAS · branch · entries) and clears the form; **Resume** brings it back (setting the open batch aside first); **Delete** after confirming. Stored in this browser (localStorage), cleared on sign-out (`lib/use-parked-drafts.ts`, `components/parked-drafts.tsx`). Tested (Waiver).

### Missed months, 60D and suspension counted from month end (2026-10-14)

- **Owner:** temporary suspension and 60D were wrong: a member who paid in July for July and August, then nothing in August and September, showed suspended and 60D.
- **Cause:** the current month counted as unpaid (60D on October 1 with only September missed), and suspension started two months after the DOI day of the last covered month.
- **Owner decided:** a month is missed only once it has ended; 60D = two missed months (90D three, 120D four, 150D five+); suspended the same day as 60D. Example: U through October 31, 60D and suspended from November 1.
- **Done:** `accountState` (lib/account-rules.ts): `unpaidMonths` = months ended unpaid; suspension from the 1st of the third month after the last covered month; the amount due still includes the current month; forfeiture unchanged. SOA "Months behind" follows. Tested.
- **Production preview (October 14):** 14,193 accounts; 2,910 suspended under the new rule; stored statuses to change include 60D → U 4,275, 90D → U 1,904, 120D → 60D 628, 150D → 90D 509 (some changes are only stale stored statuses).
- **To do (owner):** after deploying, run MAM → Sync current statuses so member lists and dashboards show the new statuses.

### Report record panel organized (2026-10-14)

- **Owner:** the forms under the report (expense, cash to bank, Fidelity, Cash Beg, notes) were messy.
- **Done:** one panel with tabs Expense · Cash to bank · Fidelity · Cash Beg · Notes; one form at a time with a title and a short note, labels above their fields in a two-column grid (one column on phones), actions at the bottom; Edit on a deposit or Fidelity entry opens its tab.

### My Entries in tabs by status (2026-10-14)

- **Owner:** arrange My Entries by status like Clearing (returned, approved, waiting for receipt, for approval).
- **Done:** batches in tabs Waiting for receipt, Not yet sent (only when there is one), For approval, Returned, Approved, with counts; a mixed batch goes under the status needing attention first; batch badges use the same words (For approval, Approved, Waiting for receipt, Not yet sent).

### Clearing grouped by status, Edit, Collected by from the role (2026-10-14)

- **Owner:** arrange Clearing by status; add Edit for a wrong Remitting, branch or MAS; when the cleared person is a Collector, Collections should default Collected by to Collector.
- **Done:** Clearing lines in tabs by status like Remittances (owner, same day; first done as groups): Waiting for encoding, Waiting for receipt, For approval, Returned, Approved today (approved then removed), each with its count, newest first. Edit on each line (not Approved or Removed): branch and MAS / employee only while nothing is encoded; a kind can be unticked only when none of its entries are encoded; same checks as a new clearing; own clearings unless administrator (`editClearing`). Collections: picking someone whose role is Collector (and not MAS) presets Collected by Collector, otherwise MAS; the clerk can change it. Tested.
- **Open:** members carry a status (Active: MAS collecting; Collector: transferred to a collector after the MAS resigned or went inactive; DTO: paid at the office). Collected by is still per batch; a Collector handing in both transferred and own members encodes them as Collector (Collector tier).

### Report branch list: assigned branches only (2026-10-13)

- **Owner:** the report's branches are not accurate: CABALLERO, JENNY is assigned to MINTAL, but the list had AGDAO (one New Sale she encoded on October 9).
- **Done:** the Branch list holds the primary branch and the branches assigned in Employees, plus All branches (no longer every branch ever encoded for). Entries for any other branch still count under All branches and in Audits.

### Report notes in the audit (2026-10-13)

- **Owner:** report comments (Specific Rmks, Other Comments) are not reflected in the audit report.
- **Cause:** since reports were split by branch, notes are saved per branch (`employee|kind|start|branch`); the All branches report (Audits, Report Review) read only notes without a branch.
- **Done:** All branches gathers every branch's notes for the clerk and period (labelled by branch when several), adds pending cash and each branch's typed Cash Beg. Checked on production for October 13 (e.g. CABALLERO, JENNY's MINTAL notes, AMBASING, CHARNNY's CALINAN comment). Tested.

### Collapsible sections that fit the screen (2026-10-13)

- **Owner:** in Audits, Entries by program collapsible, each list (New Sales, Collections) in its own scrolling card; Every entry still too wide, make it fit and collapsible.
- **Done:** Audits → Entries by program folds open/closed; New Sales and Collections lists each scroll in their own card (max about 18 rows high). The report's Every entry is a list instead of an 11-column table (each entry one row: entry and encoding time; OR / application, OR date and Date Remitted; member, PH number and MAS; amount and incentive; status, receipt and Details), wrapping on narrow screens, folding open/closed and scrolling in its own card; printing shows it in full.

### Audits match the clerk's report; one Fidelity list (2026-10-13)

- **Owner:** the audits report and the Entry Clerk's report are not the same; the Fidelity received total and Fidelity Bond should be the same.
- **Cause (production, October 13):** Audits add up every branch the clerk encoded for; the clerk's Reports page opens on their primary branch (e.g. ABESIA, DARYL JANE ₱24,510 in Audits vs ₱10,680 MATINA; GARCIA, JASPER ₱5,690 vs ₱0 BALIOK). Clerks with one branch matched exactly. The Fidelity list showed only Fidelity added after encoding, while Fidelity Bond also counts Fidelity entered with a batch.
- **Owner's choice:** one audit per clerk, showing each branch.
- **Done:** the audit card has By branch (accounts, collected, incentives, Fidelity, penalties, expected remittance per branch, plus All branches), each line equal to that branch's report; the report inside the audit opens on All branches with a Branch choice. Reports list every Fidelity received (with the batch, or added after encoding) under Fidelity received, whose total is the Fidelity Bond line; only the later ones have Edit / Void. Checked on production for every clerk on October 13. Tested.

### Audits arranged; report without sideways scroll (2026-10-13)

- **Owner:** arrange Audits neatly; the opened report should not scroll horizontally.
- **Done:** Audits lists one card per Entry Clerk (name, ID and branch, accounts, collected, expected remittance, status, Audit / View); the opened audit has sections Figures, Daily audits, Entries by program, Report and every entry, Decision. The clerk report (Reports, Report Review, Audits) has no fixed minimum width any more (was 980 px, 760 px for the MAS summary, 1,000 px for every entry): sections stack on narrower screens and text wraps; printing keeps the paper layout.

### Entries without incentives on October 13: check and fix (2026-10-13)

- **Owner:** check again for MAS without incentives today and fix.
- **Found (production):** no forfeits left; every New Sale has its incentive; 3 collections had none because they were saved as Collected by Collector on programs whose Collector tier was 0%: TANGAL, MARY JEAN (a MAS, D-320 NOP 29, ABESIA, DARYL JANE, MATINA) and GOTUAL, FLORYL JAY (a Collector and the accounts' MAS on record; D-350 (5Y) NOP 9 and D-370 NOP 44–45, CABALLERO, JENNY, MINTAL).
- **Owner decided:** Tangal: leave as is. Collector tier 10% from month 13 on D-350 (5Y) (13–60), D-370 (13–96), D-320 (13–60); months 1–12 stay 0%.
- **Applied on production:** `scripts/set-collector-tiers.mts --apply` set the three tiers and recalculated Gotual's slip REM-20261013082847-TH8J (₱1,111.50) → REM-20261013085527-WKVX (₱1,037.50): D-370 incentive ₱74, D-350 (5Y) NOP 9 stays ₱0. Tangal's slip (REM-20261013081611-ZVKX) untouched; recalculated with the new D-320 tier it would get ₱32.

### Every incentive kept on October 13 only (2026-10-13)

- **Owner:** allow all entries only for today to have incentives, even the clearing is after 3 PM.
- **Done:** `INCENTIVE_GRACE_DAYS = ["2026-10-13"]`: cash received that day forfeits nothing; the 3:00 PM deadline applies again from October 14. Tested.
- **Applied on production:** today's two pending slips that had forfeits were returned and re-sent (`scripts/recalculate-moved-date-remitted.mts --slips=…`): BALAIS, MARICEL (PANTUKAN) REM-20261013021513-EPS9 ₱1,590 → REM-20261013082941-W8SA ₱1,392.90; ANIB, NORMA (TAGUM) REM-20261013035052-M0CE ₱2,080 → REM-20261013082959-XV8W ₱1,824.10; ₱453 of incentive kept; no forfeits left on slips received October 13.

### Fidelity handed in after encoding (2026-10-13)

- **Owner:** allow Fidelity after the entries are encoded (MAS sometimes add Fidelity later); add something for Fidelity in the report. Owner's choice: its own entry, confirmed by an approver.
- **Done:** Reports → Add Fidelity (MAS, date, amount, remarks) saves a Fidelity slip (Remittances, type Fidelity, no entries); the report lists it and counts it in Fidelity Bond at once; approval in Remittances makes it count in the MAS's Fidelity savings; Edit / Void until approved. Remittances shows it as a Fidelity slip (no View entries). Tested.

### Forfeited accounts today only; deposits can be edited (2026-10-13)

- **Owner:** allow entries for forfeited accounts just today; in reports allow editing even beyond 3 PM: instead of only void, they can edit or void.
- **Done:** `FORFEITED_PAYMENT_DAYS = ["2026-10-13"]`: payments on forfeited accounts pass on that day only (form and save), blocked again from October 14. Reports: Edit next to Void on each bank deposit (date, bank account, amount, type, MAS, remarks; own or administrator; not voided). There is no 3:00 PM lock on reports (3:00 PM is only the incentive deadline). Tested.

### Reports: no incentives, deposits not showing; DTO label (2026-10-13)

- **Owner:** reports show no incentives and no cash flow, even after saving; a DTO transaction should say DTO, not the MAS or Collector name.
- **Found (production, read-only):** the report itself works (ABESIA, DARYL JANE, MATINA, October 13: incentives ₱1,130 + ₱300, 4 deposits). CABALLERO, JENNY's five collections (OR date Sunday October 11, Date Remitted moved to October 12 for an entry clerks' meeting) had their ₱474 incentive forfeited: the cash counts as received at her clearing, October 13 12:08, after the 3:00 PM October 12 deadline. Her two deposits (₱992, ₱725) were saved with deposit date October 12, so they are on the October 12 report while her entries (by date encoded) are on October 13.
- **Done:** DTO payments show as DTO (report, Today's Entries, Remittances). Tested.
- **Owner decided:** yes: the Date Remitted is when the MAS really remitted; the clerk received the cash but could not encode or clear it that day. **Done:** a Date Remitted moved earlier with a reason counts the cash as received on that day (start of the day), so an on-time incentive is kept (`receivedAtOf`). Tested.
- **Applied on production (owner's request):** `scripts/recalculate-moved-date-remitted.mts` returned and re-sent CABALLERO, JENNY's two pending slips: REM-20261013061728-IUZM (₱1,130) → REM-20261013072247-A8NI (₱782); REM-20261013065406-0AG5 (₱851) → REM-20261013072256-7D25 (₱725); ₱474 of incentive given back, forfeits cleared; the returned slips keep the reason.

### New Sales refused although the MAS is in Clearing (2026-10-13)

- **Owner:** CABALLERO, JENNY cleared SUYMAN, NELSON (MINTAL, both kinds) but New Sales says he is not in Clearing for New Sales.
- **Cause:** his Collections were saved with Date Remitted October 12 (reason: entry clerks' meeting) and, being cash, went for approval at once, which marked the October 13 clearing Encoded. A later day's clearing covered an earlier Date Remitted only while Open, so his New Sales for October 12 were refused.
- **Done:** a later day's Encoded clearing still covers an earlier Date Remitted for a kind it covers that is still waiting for encoding (same per-kind check as From Clearing); a kind already encoded stays refused. Checked against production (New Sales Oct 12 allowed, Collections Oct 12 refused). Tested.

### ORC and reactivation incentives (2026-10-13)

- **Owner:** ORC (outright commission): both the Collector and the MAS get their incentives, with a Yes/No; reactivation: whoever collected (MAS, Collector or ORC) gets only 10%. Owner's answers: ORC both incentives deducted, set per batch; reactivation 10% of (base pay − mark-up), per entry; reactivation and ORC cannot go together.
- **Done:** Collections → ORC Yes/No per batch; Reactivation Yes/No per entry (existing field) now sets the 10% incentive; preview, save and the returned-batch editor use the same rule. Tested.
- **Rule corrected (owner, same day):** ORC is for a Collector batch: the Collector earns half of the MAS incentive and the other half goes to the remittance (not MAS + Collector both). Assumed: ORC only with Collected by Collector; in a non-commissionable period (MAS earns nothing) the Collector keeps their own tier.
- **Data (production, October 13):** 393 imported old-sheet collections carry the old sheet's flags: reactivation 228 (160 accounts), transferred 160 (92 accounts), both 5; all dated 2026, none at NOP 1, most not the account's first payment; only 15 reactivation and 8 transferred accounts have another program account of the same member in the system. D-210 HG holds 124 of the reactivation payments (106 not whole months of its ₱150 minimum: it is flexible). The old flags are not recalculated by the new 10% rule.

### Clearing: who approved (2026-10-13)

- **Owner:** in Clearing, Approved today, show under the status who made that status, for tracking.
- **Done:** under each kind's status, Approved by / Returned by with the approver's name and time, from the entries' remittance slips (one line per person and decision). Tested.

### Clerk reports per branch (2026-10-13)

- **Owner:** reports must be separated by branch: for this branch, the report for today, the week, the month and the year; some Entry Clerks are assigned to several branches.
- **Done:** Reports → Branch, always shown (primary branch by default; primary, assigned and every branch ever encoded for, plus All branches; at first it was hidden for a clerk with one branch in the period, e.g. CABALLERO, JENNY: assigned MINTAL only, one New Sale for AGDAO), kept across the Daily / Weekly / Monthly / Yearly tabs. Entries, expenses and deposits are filtered by branch; notes and Cash Beg are kept per branch (older notes count for the primary branch); expenses and deposits are saved for the report's branch. Report Review can choose the branch too; Audits stay on all branches. Tested.

### DTO batches for members of resigned or inactive MAS (2026-10-13)

- **Owner:** resigned or inactive employees cannot be chosen, but their members keep paying (DTO); clerks need a way to encode those accounts.
- **Production (October 13):** 648 accounts not forfeited under 36 resigned MAS, 127 under 8 inactive MAS, and 37 whose MAS matches no employee (7 names).
- **Owner's decisions:** the receiving clerk is accountable; no clearing; any account of the branch; the account keeps its old MAS (reassign later with Programs → Transfer members).
- **Done:** Collections → Batch type → DTO: paid at the office (no clearing, branch chosen, Date Remitted today or earlier, members searched across the branch, no incentive / penalty / Fidelity, clerk accountable as DTO). DTO collections are outside every clearing; the returned-batch editor needs no clearing for them. Tested.

### From Clearing: MAS cleared but not listed (2026-10-13)

- **Owner:** a MAS is in Clearing but does not show in New Sales or Collections.
- **Cause found:** sending one kind for approval (cash Collections go at once on save) marks the whole clearing Encoded, even one ticked for both; From Clearing listed only Open clearings and today's Encoded ones, so from the next day the person was missing from the other kind's list (e.g. on October 13 PAÑARES, NIMFA had Collections but no New Sales yet; GARCIA, JASPER the other way round).
- **Done:** an earlier day's Encoded clearing stays in From Clearing, under the kind still waiting for encoding only, marked not encoded yet. Tested.
- **Other reasons someone is not listed (by design):** a clerk sees only the clearings they made (October 10); a clearing ticked for one kind shows only under that kind; Removed clearings are not listed.
- **SACAY, HANELYN (STA. CRUZ, GARCIA, JASPER):** today's clearing was ticked New Sales only, so she was not in Collections; clearing her again for Collections was refused while that one was open (and it could not be removed, 2 New Sales are saved on it). **Done:** a second open clearing the same day is refused only for a kind already open. Tested. Her October 12 cash collection (OR 12958 B) is Outstanding and on no slip after its slip was rejected (wrong mode of payment); the clerk fixes and sends it from My Entries.

### Clerk report: Cash Beg can be typed (2026-10-13)

- **Owner:** Cash Beg is the cash received, so the clerk should be able to edit it; it must not be affected by everything else, it is case by case.
- **Done:** on their own report the clerk types Cash Beg for this report with a reason; the summary shows it with the calculated figure; it applies to that report only (kind and period), nothing recalculates it, and other reports keep their own; Clear removes it. The old calculated Cash Beg (carried from all earlier entries, expenses and deposits) is cleared at the owner's request: without a typed one, Cash Beg is zero. Migration `0023` adds four columns to `report_notes`. Tested.
- **To do (owner):** run `npm run prod -- npm run db:migrate` and `npm run prod -- node scripts/check-database.mjs` (24 of 24) BEFORE pushing; otherwise the clerk report cannot be read on production.
- **Open question:** bank and GCash batches count as cash on hand in the report unless a matching cash forwarded to bank is recorded.

### Leave Approvals tabs; Attendance Review search and its sidebar number (2026-10-13)

- **Owner:** arrange Leave Approvals as Pending, Approved, Rejected; add a search/dropdown in Attendance Review; its sidebar number always says 99+ even after marking almost everyone.
- **Cause of 99+:** the number counted Absent by system records of the last 7 days, while the page shows one day. On October 13 all 90 marks were No attendance needed for today, but October 6, 7, 8 and 12 still had about 90 unmarked system absences each (about 85 of the 95 on October 12 are MAS); about 49 a day belonged to employees no longer active, who cannot be marked at all.
- **Done:** Leave Approvals in tabs with counts. Attendance Review: Employee search dropdown; a bar of the waiting days with counts, click to open. The sidebar number counts only active employees the page lists, once per person and day, and not when a manager's mark exists. Tested.
- **To do (owner):** mark the waiting days (filter role MAS, Select all, Mark selected as No attendance needed) to bring the number down.
- **Answered (October 17, 2026):** MAS must be marked No attendance needed by hand every day, or the system records them Absent. A standing setting (e.g. per role or per employee: no attendance needed) would stop that. The owner chose carry-over: a No attendance needed mark now carries to the next working day until the employee clocks in or is marked otherwise (see Attendance fixes, October 17).

### Collections: account not found when the MAS name differs in capitals (2026-10-13)

- **Owner:** Collections says A unique program enrollment was not found for PH-88659933 (DS-500) although the program is selected; the history shows 0 collections.
- **Cause:** the account's MAS is Nagliba, Marissa; the employee and the Clearing pick are NAGLIBA, MARISSA. Collections compared the names exactly (loading the account and saving). About 250 of her accounts are spelled the other way; other MAS can have the same mix.
- **Done:** Collections compares branch and MAS ignoring capitals and extra spaces, as the account loading already did. Tested.
- **Optional (owner):** make account MAS names match the employee's spelling, so every page shows one name.

### OR No. in a member's MAM (2026-10-13)

- **Owner:** adjust the individual MAM first, add the OR number, to compare records more easily (to check whether PH-36482213 and PH-88659933 were the same person).
- **Done:** the member's MAM table has OR No. and OR Date columns, one line per receipt.
- **Decided (owner, after comparing):** PH-36482213 (DENNIS, D-350 (5Y)) and PH-88659933 (ARIES, DS-500) are different people; not merged. OR 23296 N stays on ARIES's DS-500 account. Recorded under `notSamePerson` in `config/name-merges.json`.

### DS-320 missing from New Sales; one code per program (2026-10-13)

- **Owner:** New Sales does not show all programs; DS-320 cannot be picked.
- **Cause:** on production, DS-320 (DP-0004) and D-320 (DP-0011) both have code `320`, and D-350 (5Y) (DP-0009) and DPB-350 (DP-0010) both have `350`. The program list was keyed by code, so only one of each pair showed. A clerk who picked 320 could get D-320 when they meant DS-320. Accounts link to programs by ID, so their data is not affected.
- **Done:** New Sales picks the program by ID (older drafts and MAS submissions fall back to the code); Programs refuses a new or changed code that another program already uses. Tested.
- **To do (owner):** in Programs, give the four programs their own codes (for example DS-320, D-320, D-350, DPB-350). The app now uses IDs, but the program lists show the same code twice and `scripts/fix-legacy-receipts.mjs` still matches programs by code, so unique codes avoid mix-ups.

### Date Remitted can be changed, with a reason (2026-10-13)

- **Owner:** let the Date Remitted be edited, but ask why it was changed: sometimes there is work but it cannot be encoded because of meetings and other reasons.
- **Done:** New Sales, Collections and the returned-batch editor: Date Remitted is editable (starts on the clearing day); a day other than the clearing day needs a reason (5+ characters), checked in the browser and on the server, and kept with each entry (`date_remitted_reason`, migration `0022`). Branch and MAS stay locked to Clearing. The new day must still be covered by a clearing (an Open clearing covers earlier days). Tested.
- **Production:** the code went live before the migration on October 13, 2026, so New Sales and Collections saves failed (column date_remitted_reason missing) until `npm run prod -- npm run db:migrate` was run the same day; check-database: 23 of 23 migrations, OK.
- **Not yet:** the reasons are stored but not listed anywhere (Exceptions lists late OR dates only); say if administrators should review them there.

### Batch information locked; working days for late dates (2026-10-12)

- **Owner:** lock Branch, MAS and Date Remitted in Batch information, since Clearing fills them. An OR one or more days old can be on time when Sundays or other non-working days fall between.
- **Done:** the three fields are read-only on New Sales, Collections and the returned-batch editor; they change only by choosing another person in From Clearing (a MAS submission keeps its Date Remitted editable). Late-entry reason: needed only when the date is before the last working day before today. Incentive deadline: 3:00 PM the next working day after the OR date (Remittances, Today's Entries, Exceptions). Non-working = Sundays plus the days declared non-working in the attendance calendar for the branch. Tested.
- **To do (owner):** declare holidays the office is closed as non-working days in the attendance calendar (Attendance), so they count.

### MAM rows and 60D (2026-10-12)

- **Owner:** a member's MAM repeated the month before's NOP and Month of in months with no payment (e.g. PH-52925058 looked like many repeated entries); old-sheet receipts covering several NOPs showed only one. 60D should mean two unpaid months, not one.
- **Done:** per month, NOP paid and Month of come from that month's receipts (ranges for multi-month receipts, — when none); months before the DOI are not listed; the MAM page's Month of works the same. Status: one unpaid month (this month) is still U; 60D = 2, 90D = 3, 120D = 4, 150D = 5 or more unpaid months (the displayed balance multipliers already matched this). Tested.
- **To do (owner):** after deploying, run MAM → Sync current statuses so the stored statuses (member lists, dashboards) follow the new 60D rule.

### Edit a returned batch (2026-10-12)

- **Owner:** when the approver returns a batch, the Entry Clerk can edit the whole batch as they encoded it, only while it is returned.
- **Chosen (owner):** an editor on My Entries rather than reopening the encoding forms; members and programs stay, a wrong entry is removed and encoded again.
- **Done:** Edit batch on Returned batches: batch details and every entry, remove entries; same checks as encoding; IDs, photos and encoder kept; Record Corrections keeps each change; then Resubmit batch. Tested (Collections and New Sales).

### Receipt photo viewer (2026-10-12)

- **Owner:** a photo should open big on the screen so it can be read.
- **Done:** View receipt (every page that shows receipt photos) opens full screen on a dark background, the photo fitted as large as the screen allows (small photos enlarged). Zoom in and out (buttons, or click the photo for 2×; up to 4×, scrolled), rotate a sideways photo, close with ×, Esc or a click beside the photo.

### Week of the month in reports (2026-10-12)

- **Owner:** October 12 showed as the 3RD WEEK; it is the 2nd.
- **Done:** week N is the week of the month's Nth Monday (as the company sheets count: October 12 = 2ND WEEK, September 30 = 4TH); days before the first Monday are week 1. Before, the partial week from the 1st counted as week 1. Tested.

### NOP and Month of in MAM (2026-10-12)

- **Owner:** a member's own MAM should show NOP and Month of; the MAM page should show Month of.
- **Done:** Month of = the month the latest NOP pays for (the DOI's month for a New Sale only). Member MAM: NOP and Month of in the header and per month, and each receipt's NOP range. MAM page: Month of in each month cell and the CSV.

### Clearing lines that never finished (2026-10-11)

- **Owner:** Jenny's clearings are only for New Sales and Jo-ann's only for Collections, but their existing lines (made before Clearing asked what is remitted) count as both, so they wait for the other kind forever.
- **Done:** `scripts/set-clearing-covers.mjs --clerk=<name or ID> --covers=NewSales|Collections|Both` (dry run; `--apply`) sets every clearing a clerk made (not Removed) to that kind; each line then follows only its own entries and leaves once they are approved.
- **To do (owner):** `npm run prod -- node scripts/set-clearing-covers.mjs --clerk=JENNY --covers=NewSales` and `--clerk=JO-ANN --covers=Collections`, then each with `--apply`. From now on they tick the right kind when clearing.

### Per-MAS report CVE (%) (2026-10-11)

- **Owner:** add the per-MAS "New Member and Collection" report (weekly, monthly, yearly) for Entry Clerks; the sheet's CVE% is G/J (Collection GROSS ÷ CVE GROSS).
- **Found:** the sheet already exists on the Weekly, Monthly and Yearly tabs of Reports and Report Review (below the main report, printed on its own page); only CVE was blank.
- **Done:** CVE ACCTS / GROSS = the MAS's open accounts in the report's branch with a monthly due in the period and those dues; CVE% = Collection GROSS ÷ CVE GROSS × 100. Tested.

### Latest old Google Sheet download (2026-10-10)

- **Owner:** uploaded the latest `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx`; migrate the new rows.
- **Fixed in the importer:** it reads whole tables while parsing the workbook; the database client's 20-second idle timer closed a connection under a query ("CONNECTION_CLOSED"), so scripts can turn it off (`DAYONG_DB_IDLE_TIMEOUT=0`, set by the importer, which also uses the session connection). An unknown program label is now named in the report.
- **Program labels:** labels of programs merged and deleted this week point where their members went (D-300 (NEW), D-300 (NEW BRACKETING), DN-300 → D-300 (BRACKETING); D-150 → D-210 HG; DPB-490 → D-490; DFP-350, DPB-350 (6Y) → DPB-350). The sheet now also has the web app's programs in several spellings (DS-320, DS-430, DCA-400, DS-500; DS-500 (5Y) → DS-500). D-290 (500) follows the DOI rule: a New Sale before August 2026 is D-290, from August DSP-290; a payment follows the member's D-290/DSP-290 New Sale, else the member's earliest such payment; 8 payments with neither are listed.
- **Staging dry run:** 190 members, 303 accounts, 131 New Sales, 1,505 collections (1,402 on existing accounts); 42 held back (gaps or overlaps with the account's history), 8 accounts held back (payments already under another account), 50 reused OR numbers flagged. Owner: DSP-320 is a typo for DS-320; DLA-600 and DLA-450 are programs on production (staging lacks them, so they show there as unknown).
- **Production dry run (first):** 686 accounts held back as "payments already under another account": accounts moved or merged in this system since the first import (their program changed, so their ID no longer matched), each with a new payment. Fixed: when every stored payment of such an account sits in one account, its new payments go to that account (its own member, PH number and program), still checked against its history. Unknown labels on production: D-490 (and the DPB-490 rows mapped to it), D-700, DPB-650, D-430; the importer now prints, for each unknown label, the programs there with the same number, so the alias can be set.
- **Production dry run (second):** 683 moved or merged accounts now get their new payments; 3 held back. It still meant to create 411 accounts for 131 New Sales: accounts moved to another program with no payment yet were not recognised and would have become second copies (the database allows one account per member and program). Now an account is also matched by its stored New Sale (the account that sale belongs to now) and by the member's existing account in that program (staging: 304 → 199 new accounts).
- **Program labels (owner, October 10):** all 490 labels → DP-0037 (the finalized 490, named DPB-490 on production; aliases may now name a program ID); D-700 → DPB-700 (DP-0024); D-430 → DS-430 (DP-0055); DPB-650 → DFPP-650 (DP-0027).
- **Applied on production (October 10):** 129 members, 207 accounts, 132 New Sales (14 flagged duplicates), 2 beneficiaries, 1,482 collections (51 flagged duplicates); 897 moved or merged accounts received their new payments. Left out: 41 payments that do not fit their account's history (`backups/legacy-held-new-*.txt`), 8 accounts with payments that are not whole months, 8 D-290 (500) payments without a DOI, 13 rows with an unknown branch, and the owner's leave-outs (full list: `backups/legacy-migration-report-*.txt`).
- **Also:** the importer now reads the tables one at a time and retries a dropped read (the connection sometimes drops on the 60,000 collections). "WarnSendingBroadcastMessage" during the write only means the live-update notice was not sent.
- **To do (owner):** run the dry run once more to confirm nothing new is left; staff review the held-back rows.

### Dates, OR letters and amounts (2026-10-10)

- **Dates out of order (owner: use the application date):** `scripts/fix-remitted-before-receipt.mjs` sets a Date Remitted that is before the receipt/application date to that date (New Sales and collections not on a remittance slip); a receipt or application date in the future is itself the typo and is listed instead. The 4 late remittances (21–32 days after) are real and stay.
- **OR numbers (owner: use the letter mostly used):** `add-or-branch-letters.mjs --most-common` gives every remaining bare OR number the letter most used by the same MAS/Collector's nearby receipts, else the branch's nearby receipts, else the branch overall (only letters the branch really uses, 10% or more), skipping a letter whose number is already another receipt's. Staging: 375 of 534; left: HINATUAN 137 and AGDAO 18 (their usual letter's number is already another receipt's) and 4 others, in `legacy-data/or-letter-fixes.csv`.
- **Amounts (owner):** `scripts/fix-amounts.mjs` with `config/amount-fixes.json`: New Sales at ₱0 get the program's amount; collections paying exact multiples cover that many months (accounts renumbered); best guesses: SALE-WEB-297 ₱50 → ₱500, SALE-WEB-322 ₱860 = New Sale + next month (a collection is added), COL-WEB-1411's account to DCA-400 only if its New Sale and payments fit ₱400 (on staging its New Sale is ₱320, so it is left). The 11 whose amount equals another program's rate go to staff in `legacy-data/amount-checks.csv`.
- **To do (owner):** dry run then `--apply` on production for `fix-remitted-before-receipt.mjs`, `add-or-branch-letters.mjs --most-common`, and `fix-amounts.mjs`; staff check `amount-checks.csv`.

### Possible duplicates (2026-10-10)

- **Production (21, all from the old web app):** `scripts/compare-duplicates.mjs` (read-only) shows both records of each.
- **Same person twice (6):** same birthdate, same name but for spelling or a full middle name, no shared program. `scripts/merge-members.mjs` with `config/member-merges.json` merges each into the old-sheet member (or the full-name one), moving accounts, collections, New Sales, transfers and beneficiaries, filling blank details, and deleting the other member (dry run rolls back). Staging dry run: all 6 fine.
- **OR 16023 B (TORIL, PH-70850331):** same member, date and ₱320 recorded for September and October; if the paper receipt is ₱320, delete COL-WEB-1460.
- **Application 06202600077 (BUHANGIN):** one member on 320 and DCA-400 with one number; fine if she used one form for both.
- **Need the paper:** OR 23898 C (two CALINAN members, same day and amount); application numbers repeated for different members (#2, #4, #6–#12; 2026C00500 on five sales by one MAS in a week).
- **Owner (October 10):** all six pairs are the same person with two programs (EVANGELINE's right spelling is ALAYAO, so the kept member takes that name). OR 16023 B is one receipt, for September: the October copy COL-WEB-1460 is deleted. Application 06202600077 belongs to the program being paid; the other sale's number becomes "06202600077 (need edit)". OR 23898 C: the paper cannot be found; both payments stay as recorded.
- **Done:** `config/member-merges.json` confirmed; `scripts/fix-duplicates.mts` with `config/duplicate-fixes.json` (deletes the duplicate collection through the admin delete and recalculates the account's status; settles the application number by which account has payments, showing the member so staff can find the form).
- **Production dry runs (October 10):** the six merges join each pair under the kept PH number (birthplace and gender filled where blank; names ALAYAO, CASTILLO, GALVE); COL-WEB-1460 (October copy of OR 16023 B) is deleted. Application 06202600077: both New Sales of PH-02261895 (BUHANGIN; the member is also the MAS on them), 320 on August 31 (SALE-WEB-1519) and DCA-400 on September 3 (SALE-WEB-1543), have no payments yet, so the rule cannot decide; nothing changes until staff find the form.
- **To do (owner):** `npm run prod -- node scripts/merge-members.mjs --apply` and `npm run prod -- npx tsx --tsconfig tsconfig.json scripts/fix-duplicates.mts --apply`; say which program application 06202600077 is for; staff look for the real application numbers of the repeated ones (#2, #4, #6–#12) and OR 23898 C stays as recorded.

### OR numbers without a branch letter; programs without rates (2026-10-10)

- **Production check:** 107 open accounts cannot be collected: no rate for months 2–12 on D-350 (53), 320 (25), D-420 (20), D-250 FG (4), DC-300 (2), D-270 (300) (1), and no rate at all on DFP-525 (DP-0048) and DSP-500 (DP-0057) (1 each). `check-incentive-periods.mjs` now also lists programs with accounts but no rate at all. **To do (owner):** set those rates in Programs.
- **Exceptions on production:** 558 OR numbers without a branch letter, 116 imported receipts sharing a number, 33 members missing details, 22 amounts not matching the program, 21 possible duplicates, 11 dates out of order (`scripts/exceptions-summary.mts`, list in `legacy-data/exceptions.csv`).
- **Done:** `scripts/add-or-branch-letters.mjs` adds a bare OR number's letter only when the data shows it: the same MAS/Collector's receipts with nearby numbers (the booklet), else the branch's nearby receipts, else the branch's one clear letter where it clashes with no existing receipt. A bare number whose lettered form exists for the same member, date and amount is listed as a likely duplicate. Staging dry run: 39 of 534 fixable; the rest (PANTUKAN/TAGUM booklets lettered both P and T, HINATUAN numbers already used with S, branches with several letters) need the paper receipt. Everything, with the reason, is in `legacy-data/or-letter-fixes.csv`.
- **To do (owner):** `npm run prod -- node scripts/add-or-branch-letters.mjs`, then `--apply`; staff check the rest against the paper receipts (correct each in Today's Entries / Corrections).

### Old web app records left out; executive dashboard (2026-10-10)

- **Done:** `scripts/web-left-out-sheet.mjs` writes `legacy-data/web-left-out.csv` (52 rows: 28 New Sales, 24 collections the import left out) with member, branch, MAS, program, application/OR numbers, dates, amount, reason and the old-site link, for staff to check one by one (stays on this PC).
- **Executive dashboard:** measured on staging after the October 10 fixes: about 0.7–1 s for its data (the slowest query runs in 0.02 s in the database, using the OR-date index); the earlier 4–6 s came from queries waiting behind each other on the pooler and from the US region. No further change; owner to check after deploying.

### DPB-490 into D-490, and a numbering correction (2026-10-10)

- **Owner:** moved all DPB-490 accounts to D-490 (the true program) with Transfer members; 3 stayed.
- **Found:** PH-47180831, PH-01234567 (MONTEVISTA) and PH-06682054 (COMPOSTELA) each have one enrollment split across DPB-490 and D-490 in the old sheet (same DOI, different receipts, NOPs overlapping).
- **Done:** `config/receipt-consolidations.json` puts every receipt of each DPB-490 account on the member's D-490 account (`fromAccounts`, new) and deletes the DPB-490 account; `config/program-moves.json` then deletes DPB-490 (DP-0034).
- **Correction:** the consolidation script renumbered from NOP 2; the October 4 rule keeps the earliest NOP recorded (months before it were paid before these records). Fixed (earliest recorded NOP, or `startNop`). The two CALINAN accounts done earlier today (PH-30272255, PH-33775036) were put one month early (NOP 2–10 from December 2025); their first receipt was NOP 3 (January 2026) in the old sheet, so they are renumbered NOP 3–11 (January–September 2026).
- **Applied on production (October 10):** the three members' receipts are on their D-490 accounts (60D each) and DPB-490 (DP-0034) is deleted; the two CALINAN accounts are NOP 3–11, January–September 2026 (60D). The old web app's latest records (3 members and New Sales, 4 collections) are imported; a re-run finds nothing new. Both configs keep these under `applied`.

### Smoother scrolling; latest old web app data (2026-10-10)

- **Owner:** scrolling looked wavy and tired the eyes; get the latest data from the old system, migrate it and fix it.
- **Done (scrolling):** cards and page headers no longer use a live backdrop blur (re-blurring the gradient under every card on every scrolled frame made it shimmer); they use a slightly more opaque fill. Only the sidebar and the top bar keep the blur. The body background is no longer `fixed` (the page scrolls inside `.app-main`).
- **Done (old web app):** `scripts/legacy-site-export.mjs` re-run: 3 new members with their New Sales and 4 new collections since October 8 (2,142 members and sales, 1,126 collections in all). `config/legacy-site-map.json` now sends the old site's D-300 (NEW) to D-300 (Bracketing) and DS-500 (5Y) to DS-500 (both deleted on production in favour of the finalized programs; the DS-500 (5Y) draft is no longer added). The import's dry run now lists the programs the new accounts go to and flags a new draft program.
- **To do (owner):** `npm run prod -- node scripts/migrate-legacy-site.mjs` (dry run; counts only), then `--apply`. Records it leaves out are listed by old-site record ID in `legacy-data/web-import-report-*.txt`.

### The last three accounts that would not merge (2026-10-10)

- **Found (production dry run):** three accounts stayed because merging would cover a month twice: ENR-WEB-33 (D-300 (NEW), PH-84755298, MONKAYO) with the member's D-300 (Bracketing) account, both application 00307; and the two DP-0050 accounts of PH-30272255 and PH-33775036 (CALINAN), each holding one March 5, 2026 receipt numbered NOP 5. DP-0038, DP-0040 and DP-0051 were already moved and deleted (now under `applied`; the move script now skips a move whose program is gone instead of stopping).
- **Owner:** PH-84755298 is one enrollment: join its receipts (18017N June 8, 18044 N July 24). PH-30272255's receipts 9243 C, 13584 C, 9857 M, 15384 C and PH-33775036's 13853 C, 10942C, 9241 C, 9861 M, 15388 C, 17106 C, 19618 C, 21671 C, 22138 C were entered under different programs; each member is registered only to the final DPB-350 (DP-0010).
- **Done:** `scripts/consolidate-member-receipts.mjs` with `config/receipt-consolidations.json` (dry run makes the changes and rolls them back): moves the listed receipts to the member's account in the right program, renumbers it in OR-date order from NOP 2 (months from the DOI), recalculates the status, and deletes the member's accounts left without payments (a duplicate New Sale with the same application number is deleted; any other moves). Staging dry run: both CALINAN members end with nine receipts, NOP 2–10 (December 2025 to August 2026), status 90D; four emptied accounts deleted.
- **Applied on production (October 10):** PH-84755298 now has 18017N and 18044 N as NOP 2–3 on D-300 (Bracketing) (status 120D; the duplicate D-300 (NEW) account and New Sale SALE-WEB-33 deleted); PH-30272255 and PH-33775036 each have nine receipts as NOP 2–10 on DPB-350 (DP-0010) (status 90D; four empty accounts deleted). Then the move script deleted D-300 (NEW) (DP-0025), DPB-350 (DP-0050) and DFP-350 (DP-0056, its one account merged into DPB-350). The configs keep these under `applied`; the D-300 first-year move (DP-0065 → DP-0067, next payment in NOP 2–12) stays for future runs.

### DFP-350, DPB-350, D-300 (NEW) and Transfer members (2026-10-10)

- **Owner:** DFP-350 → DPB-350 (DP-0010) and delete; delete DPB-350 DP-0050 (DP-0010 is the finalized one); D-300 (NEW) → D-300 (Bracketing) and delete; and a feature for administrators to move all or selected members of a program to another with the same pay.
- **Done:** `config/program-moves.json` has DP-0050 → DP-0010, DFP-350 → DP-0010 and D-300 (NEW) DP-0025 → DP-0067, each merging into a member's existing account and deleting the program once empty (inactive if anything is left, e.g. two accounts that paid the same month). Programs → **Transfer members** ([system guide](system-guide.md#3-programs-rates-and-incentive-rules)), tested (move, merge, left, different pay refused, administrators only).
- **Fixed on the way:** the October 10 database change for the Audits hang (`max_pipeline: 0`) broke every transaction ("UNSAFE_TRANSACTION", seen when saving a program); transactions now have their own pool. Tested: 10 transactions with 20 heavy reads at once, all fine.
- **To do (owner):** `npm run prod -- node scripts/move-program-accounts.mjs --apply` (or use Transfer members on Programs once deployed). Accounts left behind are listed in `legacy-data/program-moves-left.txt`.

### Audits error and pages that hang (2026-10-10)

- **Owner:** Audits shows "Unexpected token 'A', "An error o"... is not valid JSON", and not only there.
- **Found:** the server never answered (Vercel's plain-text error page). The database driver pipelined two queries per connection (`max_pipeline: 1` allows two), which Supabase's transaction pooler stalls on; Audits builds every clerk's report at once and hung (on staging it never finished; once a reply was read as another query's rows). Also, "by date encoded" ranges read every imported row (about 60,000, dated by their import on October 1, 4 and 8).
- **Done:** `max_pipeline: 0` in `lib/db.ts` (Audits about 2 s; 30 page loads at once 3.5 s, none failed, before about 5 minutes with failures); imported rows left out of "by date encoded" views; every page shows a plain message when the server fails instead of the JSON error.
- **To do (owner):** deploy, then open Audits (daily, weekly, monthly). If any page still fails, note the page and the time.

### Reports and Company Reports (2026-10-10)

- **Owner:** keep Reports (the admin's own encoding report) and Company Reports both; Company Reports must be in Roles and given to CEO / President.
- **Done:** Company Reports moved to its own page `/company-reports` (sidebar for Administrator and CEO / President; Roles → Page access lists it). Reports is back to the user's own report for everyone. `/api/reports` (company figures) now needs Company Reports or Report Review access.
- **To do (owner):** if CEO or President has page access configured in Roles, tick "Company Reports (every branch)" there (defaults apply only to roles without a configured list).

### SOA total paid (2026-10-10)

- **Owner:** on the SOA, Total paid is the latest NOP times the monthly pay; for a flexible program, all the amounts paid added up.
- **Done:** `lib/statement-of-account.ts` (it was the New Sale amount, registration fee included, plus every collection). The SOA shows how it was worked out under the figure. No database change.
- **Decided (owner, October 10):** Program balance = total payable less Total paid (it subtracted the collections only). Done.

### Clear payroll runs (2026-10-10)

- **Owner:** clear the payroll runs (the ones made so far are tests).
- **Done:** `scripts/clear-payroll-runs.mjs` (dry run; `--apply`; `--only=PAY-...`) deletes each run's adjustments, lines and the run; for a Paid run also its payroll cash-out, and the commissions it paid go back to Pending. One transaction; the Audit Log keeps every row. Staging: 3 runs (2 Void, 1 Draft) cleared.
- **To do (owner):** `npm run prod -- node scripts/clear-payroll-runs.mjs` (look at the list), then add `--apply`.

### Member contact from the claimant (2026-10-10)

- **Owner:** members with no contact number use the claimant's contact number (as decided October 6).
- **Done:** New Sales and member edits now fill it on their own when the member's number is blank and the claimant's has at least 7 digits. Records saved since October 6 are filled by rerunning `scripts/fill-member-contacts.mjs --apply` (only blank member contacts change; the Audit Log keeps the edit). Staging: 8,375 members without a number, only 8 with a usable claimant number; the rest have neither.
- **To do (owner):** `npm run prod -- node scripts/fill-member-contacts.mjs --apply`.

### Slow sections (2026-10-10)

- **Owner:** some sections sometimes take too long to load.
- **Found (timed on staging):** reading the whole Collections table costs 5–8 s; receipt photo upload did that on every upload (7.7 s); payroll runs did it for the incentive reference; the admin Members directory took about 4 s (two big reads one after the other); heavy pages (Members, Exceptions, MAM, Audit, Remittances, SOA, reports) reloaded 1.2 s after anyone's save, so busy hours kept them reloading; every query also pays the trip to the database in Singapore, and Vercel runs in the US unless set otherwise.
- **Done:** receipt photo upload reads only its entries (0.16 s); payroll sums incentives in the database; Members directory reads in parallel (1.8 s); longer live-update waits on heavy pages; `vercel.json` sets the server region to Singapore (`sin1`).
- **To do (owner):** after deploying, check Vercel → Project → Settings → Functions shows Singapore (sin1). If pages still feel slow at certain times, note which page and when.
- **Could do later:** paginate the Members directory on the server instead of sending every member to the browser.

### Checking a member transfer (2026-10-10)

- **Owner:** transferred RACHO K's members to RACHO KRISTINE and wants to be sure all of them moved.
- **Done:** `scripts/check-member-transfer.mjs --from=... --to=...` (read-only; names or Employee IDs): lists employees with a similar name, the transfers recorded between the two, accounts now under the new employee and accounts still under the old one by branch and status, flags branches the new employee is not assigned to (the transfer skips those) and names that disagree with the employee link. Counts only; enrollment IDs left go to `legacy-data/transfer-left.txt`. A transfer updates both the MAS name and the employee link (trigger `fill_links`).
- **To do (owner):** `npm run prod -- node scripts/check-member-transfer.mjs --from="RACHO K" --to="RACHO KRISTINE"` (use the Employee IDs it lists if the names do not match exactly).

### Company Reports for administrators (2026-10-10)

- **Owner:** Reports in the admin workspace repeated Report Review (both showed the Entry Clerk report); admins should see the actual company report.
- **Done:** in the Administrator workspace, Reports (now "Company Reports" in the sidebar) shows the company report built by `/api/reports`: period, branch / program / MAS filters, totals, cash picture and breakdowns by branch, program, MAS / Collector, day and Entry Clerk, with CSV and print. Entry Clerks (and an admin in the Entry Clerk workspace) keep their own report. No database change.
- **Could do later (if wanted):** comparison with the previous period, or a chart by month.

### Cash to approval, receipts per batch, Clearing by kind, View entries (2026-10-10)

- **Owner:** cash entries go to Pending Approval on their own; the receipt is added per batch (Collections / New Sales), not per member; in Clearing the clerk ticks New Sales, Collections or both so each is tracked apart (one can be wrong while the other is right); an approver can click a remittance and see all its entries; Clearing is not seen by everyone: each clerk sees only what they cleared.
- **Done:** all five ([system guide, section 6](system-guide.md#6-remittances-and-staff-accountability)). New Sales saved together are now one remittance slip. Migration `0020_clearing_covers` (one column, default Both, existing clearings keep working); applied on staging. Administrators still see every clearing.
- **To do (owner):** `npm run prod -- npm run db:migrate` then `npm run prod -- node scripts/check-database.mjs` (21 of 21) **before** pushing. Cash entries saved before this change stay Outstanding until the clerk presses **Send ready batches for approval** in My Entries.

### Employees see their Notices to Explain (2026-10-10)

- **Owner:** an NTE issued by an administrator was invisible to the employee.
- **Done:** My Notices page for every employee (only their own notices), a sidebar number and a banner on every page until they confirm receipt and send their explanation; the administrator's NTE table shows whether each was read and the reply. Migration `0019_nte_employee_reply` (three columns, no data change); applied on staging.
- **To do (owner):** `npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs` (expects 20 of 20), **before** pushing this commit.
- **Done (owner, October 10):** a "reviewed" mark: unread explanations count on Employees for administrators; Mark reviewed in the NTE table (migration `0021_nte_reviewed`, applied on staging).

Administrators, HR, the CEO and President (and anyone with manage-attendance) can correct a clocked-in day on the Attendance Tracking daily board: **Adjust late**, and **Set clock-out / Fix clock-out** for an employee who forgot to clock out or clocked out at the wrong time. Worked hours, overtime and undertime are recalculated exactly as at clock-out, and the change, who made it and the reason are appended to the attendance notes. Past days list anyone who did not clock out. **Resume clock** (today only, since October 8, 2026) voids a clock-out clicked by mistake: the time out and the day's worked hours, overtime and undertime are cleared, so the employee's clock runs on from the time in and they clock out again when they leave; the reason, who did it and the voided time are kept in the notes, and the employee's open clock-in page updates by itself.

## Audits (daily, weekly, monthly, yearly)

The Audits page (`/audit`, formerly Daily Audit) audits each Entry Clerk's report by day, week (Monday to Sunday within the month, since 2026-10-30), month or year, with the same workflow: HR/Finance prepare, only an Administrator approves (which locks the figures) or reopens with a reason. Weekly, monthly and yearly audits use the report totals for the whole period plus how the clerk's daily audits in that period stand. They are stored in Weekly Audits, Monthly Audits and Yearly Audits, laid out like Daily Audits with report_date = the period's first day (`npm run sheets:period-audits -- --apply`, applied 2026-10-02). The Daily summary tab still summarizes approved daily audits.

## Live updates and linked tables (from October 7, 2026)

Goal from the owner: other users see changes without reloading, and a change in one place (a branch or MAS name) shows everywhere.

- **Done, phase 1 (live updates):** every table broadcasts its name on Supabase Realtime after a change (migration `0010_realtime_changes`); 22 pages and the dashboards reload their data when a table they show changes (`lib/use-live-refresh.ts`). See system guide section 13, Live updates. Staging migrated and tested end to end.
- **Done (October 7, 2026):** production migrated (11 of 11) and phase 1 pushed and deployed.
- **Done, phase 2 table 1 (collections), steps 1–2:** migration `0011_collection_links` adds `collections.branch_id` and `collections.mas_employee_id` (foreign keys that follow ID changes). The database fills them from the branch and MAS names on every insert and name change (trigger `fill_collection_links`), so the app, the Sheets layer and scripts need no change; registering an employee or branch links collections waiting under that name (trigger `link_waiting_collections`). The columns are hidden from the Sheets layer (`HIDDEN_IN` in `lib/sheets-on-db.ts`) so position-based code is unaffected. Staging: all 60,159 branch links and 60,080 MAS links filled in 36 s with no audit rows; the 79 without a MAS link are "DTO", "Cuizon-DTO" and 7 legacy names that are not employees (listed in IT → System Health). 144 tests pass.
- **Done, phase 2 step 3 (renames follow everywhere):** migration `0012_rename_follows`. Renaming a branch updates its name on every record in all 12 tables and employees' primary branch; renaming an employee updates their name as MAS, accountable person, Fidelity, commissions, payroll lines, MAS submissions and transfers. Copies with an ID beside them are matched by ID, the rest by the old name (for employees only when nobody else had that name). Each rename is one Audit Log entry; the copies are not logged row by row (`app.link_sync` in `audit_row_change`). Before this, a renamed MAS could no longer receive collections because their enrollments kept the old name. Staging test (rolled back): busiest branch 11,158 collections + 378 sales, busiest MAS 3,565 collections + 502 enrollments, no old name left, 2 audit rows, about 9 s. 145 tests pass.
- **Done:** live updates on the last pages (User Accounts, SOA, Reports, Admin Reports, History); every data page is now live.
- **Done, every copy follows an edit (migrations 0013, 0014):** links (`branch_id`, and `mas_employee_id` / `from_employee_id` where there is a MAS) on attendance, bank deposits, cash, expenses, enrollments, transfers, payroll runs, remittances, sales and vendor bills, filled by one shared trigger `fill_links` (configured in `link_targets()`); registering an employee or branch links waiting rows in all of them. Editing a **member** now updates the copy of their details on their New Sale records and their member number on enrollments, collections, transfers and sales (`cascade_member_change`); renaming an employee also renames their login account and uses the new links. Each edit is one Audit Log entry. Not cascaded on purpose: amounts copied at enrollment or on payslips (registration amount, amount paid, base pay), which record what applied at the time. Staging: enrollments 12,016 / 12,000 linked, sales 2,731 / 2,725; rolled-back member edit updated the sale and enrollment with 1 audit row. 147 tests pass.
- **In progress:** production migrations up to 0014 (after the 3:00 PM cutoff).
- **To do (optional):** retire the text copies in favour of the links; they are a display copy the database keeps current, so this is not needed for correctness. Overall plan, 12 tables store the branch and MAS **name** as text (attendance, bank_deposits, cash_transactions, collections, expenses, member_programs, member_transfers, payroll_runs, remittances, sale_submissions, sales, vendor_payables). For each: add `branch_id` / `mas_employee_id`, fill them from the names with a check that every row matched, switch reads and writes to the IDs, then retire the text column. Afterwards renaming a branch or MAS shows everywhere at once.

## Dashboards (October 7, 2026)

- **Done:** Gross Sales tile opens the entries behind it (system guide, section 10); sales count on their Manila date; Finance dashboard about 5× faster (`financeOnly`, date-limited reads, only needed columns; see deployment-performance.md). 148 tests pass.
- **To do (optional):** executive dashboard still about 4–6 s; summing in the database would make it fast.

## Duplicate receipt and form numbers (October 7, 2026)

Owner's rule: the same entry twice → keep the most complete copy and remove the others; different entries sharing a number → mark the later copies " (duplicated)" so authorised users see the warning. `scripts/fix-duplicates.mjs` (dry run by default, `--apply`, counts only, backup in `backups/fix-duplicates-*.json`, one transaction, Audit Log user "fix-duplicates script").

- **Found on staging:** 698 OR numbers shared by 1,400 collections and 19 application numbers shared by 80 New Sales, **none of them the same entry twice** (different members, amounts, months, dates): old-workbook receipts reused on different payments. 44 of the sales carry only the series prefix ("2026SP" ×31, "2026SP-" ×13): the number was never typed and needs the paper form. One pair of members has the same name and birthdate (left for review in Exceptions).
- **Done on staging and production (October 7, 2026):** 702 collections and 61 New Sales marked, the 3rd+ copies numbered "(duplicated 2)", "(duplicated 3)" (46 rows) so marked copies never match each other; no OR number is shared by posted collections any more. Exact copies to remove: none. The dry run reports rows marked by earlier runs.
- **Incomplete application numbers (October 7, 2026):** the 44 New Sales whose number is only "2026SP" or "2026SP-" are relabelled by the same script as "2026SP (need edit)", "(need edit 2)" … "(need edit 44)" (replacing their "(duplicated)" label) and listed in Exceptions → **Application numbers to complete** (always shown, even for imported rows). New Sales now refuse a number that is only the year and series letters (`isIncompleteApplicationNumber` in `lib/entry-controls.ts`, form and save). Staging dry run: 44 to relabel. **To do:** the owner runs `--apply` on staging and production; clerks correct each one from the paper form; review the duplicate member pair.

## Old web app export and import (dayong.gissolve.com)

The older Dayong web app (Laravel, hosted by its vendor) has no export and we have no database access. It is read with the owner's account from `.env.legacy-site` (`LEGACY_SITE_USERNAME`, `LEGACY_SITE_PASSWORD`; git ignores it). Output goes to `legacy-data/` (git ignores it) and holds personal data: delete it after the import.

- **Done (October 6, 2026):** `scripts/legacy-site-survey.mjs` mapped the site (GET only, one request per second; prints structure, never values). Every list page holds all its rows (the New Sales page is 881 MB, mostly blank space), and each record's edit form holds its full details. The member Statement of Account is a PDF, so payments come from the Collections list.
- **Done:** `scripts/legacy-site-export.mjs` writes one CSV per list to `legacy-data/export/` (members, new_sales, collections, expenses_remittance, expenses_expense, branches, programs, users, attendance, audit, reports, fidelity, matrix) and adds each member's, sale's and collection's edit-form fields (member and claimant details, beneficiaries when listed, program, branch, MAS, OR, amounts, months). Lists: 2,126 members, 2,126 New Sales, 1,088 collections, 1,114 remittances, 529 expenses, 28 branches, 47 programs, 130 users. Re-runnable: fetched records are skipped; `--lists`, `--reuse`, `--limit=N`, `--delay=ms`.
- **Done:** `scripts/legacy-site-compare.mjs` (read-only, counts only; staging by default, production with `npm run prod --`) compared the export with staging. The old site is the system used **May 2 – October 6, 2026** and still received records in October (24 members, 84 collections). Of 2,126 members only 158 are already in our database; 1,966 of 2,126 New Sales are for members not found; 1,075 of 1,088 collections have an OR number not in the database. So it is mostly new data, not a copy of the old workbook. Application numbers cannot link the systems: 731 coincide for different people in different branches. Unmatched record IDs: `legacy-data/export/not-in-database.json`.
- **Paused (October 7, 2026):** the full detail run stopped after about 800 of 2,126 members. On October 8 the owner started the migration of **members, New Sales and collections only** (not expenses, remittances, attendance or users).
- **Done (October 8, 2026): import script** `scripts/migrate-legacy-site.mjs` (dry run by default, `--apply` writes in one transaction, `--dir=` another export folder; counts, program codes and employee names only; left-out records listed by old-site record ID in `legacy-data/web-import-report-*.txt`). Rules, the same as the October 4 workbook rules:
  - **Members**: one per person (same name and birthdate, or one birthdate blank). A person already in our database (full name and compatible birthdate) gets no new member; their new account is added to them. A name matching several of our members is left out.
  - **New Sales**: one account and sale each; DOI = OR date, or the Date Remitted when the OR date is blank or before 2026 (typed birthdates). An account the member already has (same program) and a second sale of one program for one member are left out.
  - **Collections**: linked to their sale by the old site's member and program IDs (by the payer's name within the sale's name and program when details are missing; all 1,088 matched in the test). NOP comes from the months and the DOI (the sale is NOP 1); the old site's NOP column is not reliable. An account failing our rules as recorded is renumbered in OR-date order from the month after the DOI, each payment covering the months its amount pays; an amount that is not whole months leaves the account out. An account with a receipt (OR number and date) already in our database is left out for a manual check.
  - Everything is **Remitted** (remittance = amount − the old site's incentive). Receipt and application numbers already in use are flagged `legacy_duplicate` (Exceptions). OR numbers are written `12345 A`. IDs: `MEM-WEB-…`, `ENR-WEB-…`, `SALE-WEB-…`, `COL-WEB-…` (old record ID), so a re-run skips what is imported.
  - **Programs** by `config/legacy-site-map.json`: DS-430 (5Y) → DS-430, D-210 → D-210 HG, the rest by code; **DS-500 (5Y), DCA-400 and D-179 are added as drafts** (admins finalize rates, pay-balance totals, registration, incentives). **MAS**: full name, or surname + first initial ("Ma." = Maria); names it cannot place can be pinned under `mas` in the same file. **A MAS who is not an employee is registered** (owner's decision October 8, as on October 4): temporary ID `LEG-YYYY-NNNN` after the highest one in use, role MAS, active, every branch where they sold or collected (primary = the most records), no sign-in; spellings of one person (same first name and surname) become one employee under the fullest spelling. Registered in the same transaction, before the records that name them. Replace the ID with the real one in Employees → Edit later (every reference follows).
  - Beneficiaries: the old site's forms show none, so none are imported; the claimant goes on the member.
- **Done (October 8):** `scripts/merge-employees.mjs` merges employees recorded twice (`--suggest` lists same-surname pairs; pairs confirmed by the owner go in `config/employee-merges.json`): every employee ID and MAS/employee name column moves to the kept employee, branches are combined, the duplicate is deleted. It also gives records linked to an employee the employee's current name (renames before October 7, migration `0012`, did not reach the records) and lists MAS names matching no employee. Owner confirmed: Capacite, C. (LEG-2026-0025) → Ma. De Corazon B. Capacite (MD-2026-0035); Allare, M. (LEG-2026-0005) → Allare, R. (LEG-2026-0006). Applied on staging; Bautista, Lopez, Baranda, Gultiano, Balais, Garcia, Ramos and Lucido pairs are different people.
- **Test on staging (partial export, 1,288 of 2,126 member details):** 1,173 new members, 1,236 accounts (62 for members already in the database), 363 collections; statuses NS 929 · 60D 217 · U 43 · ADV 24 · 90D 22 · 120D 1; 15 accounts renumbered, 4 DOIs from the date remitted; 5 application and 3 OR numbers flagged as duplicates; 1 account with an inexact payment and 1 with a receipt already in the database left out.
- **In progress:** fresh export of the old site (October 8 lists: 2,139 members) with every member, New Sale and collection detail.
- **Done on production (October 8, by the owner):** `merge-employees.mjs --apply` (Capacite and Allare merged; older names corrected on 91 accounts, 49 sales, 172 collections, 1,517 accountable names) and `migrate-legacy-site.mjs --apply` from the export of October 8 (member details) with the October 6 New Sales and collections lists: 20 MAS registered (LEG-2026-0096…0115), 3 draft programs, 1,980 members, 2,058 accounts and New Sales, 1,069 collections. Same on staging.
- **Found on production:** accounts whose MAS name matches no employee (the employee was renamed or re-added before the name reached the records): Amora, N. 173 · Aleria, M. 167 · ANBLETH R. SILVA 130 · ALICIA B. BINANITAN 102 · Allare, R. 71 · Anib, N. 57 · ALLAN C. QUIÑONES 52 · Agua, J. 2 · Allare, M. 1. `merge-employees.mjs --suggest` lists each with the employees of that surname; confirmed matches go under `relink` in `config/employee-merges.json` (Allare, R. and Allare, M. → LEG-2026-0006 already confirmed), and the next run gives those records the employee's current name so the database links them.
- **Confirmed by the owner (October 8, from `--suggest` on production), in `config/employee-merges.json`:** re-link all 9 orphan names (Amora, N. → AMORA, NESTOR LEG-2026-0007; Aleria, M. → ALERIA, MARISSA LEG-2026-0004; ANBLETH R. SILVA → MD-2026-0040; ALICIA B. BINANITAN → MD-2026-0016; Allare, R. / M. → LEG-2026-0006; Anib, N. → LEG-2026-0008; ALLAN C. QUIÑONES → MD-2026-0062; Agua, J. → LEG-2026-0001). Merge 10 more: seven MAS the import registered are existing employees spelled differently on production (Jiramy Maglana Puya → JIRAMAY M. PUYA MD-2026-0022; Fema Felicano Escobidal → FIMA F. ESCOBIDAL MD-2026-0021; Emmarita Soriano Suwaib → EMMA RITA SUWAIB MD-2026-0046; Flordeliza Coronel Silares → FLORDELIZA C. SILARIS MD-2026-0027; Efegenia Paredes → EFEGINIA E. PAREDES MD-2026-0038; Maria Quino → MA. CORAZON C. QUINIO MD-2026-0026; Roxana Linawan Ramos → ROXANE L. RAMOS MD-2026-0073), plus Ricarte, A. → Angelina Malda Recarte (LEG-2026-0100), Elisa Ragasi Dionsion → Dionson, E. (LEG-2026-0034), Cristel Lucido → Lucido, CK. (LEG-2026-0054). Those old-site spellings are pinned under `mas` in `config/legacy-site-map.json`, so the import's re-run uses the kept employee. Not the same person (owner): Balais, Baranda, Bautista, Garcia, Gultiano, Lopez, Ramos E., Lucido Nenita, the two Suymans.
- **Done on production (October 8): import complete.** The re-run with every detail was applied; a final production dry run finds nothing left (2,122 old-site accounts imported; 13,108 members and 14,138 accounts in the database). Left out for staff to check on the old site, by record ID: 14 New Sales whose member already has that program (1762, 1774, 1919, 1948, 2043, 2064, 2067, 2081, 2090, 2091, 2094, 2108, 2109, 2145: duplicate entry or a different person with the same name), 2 New Sales with receipts already in the database (305, 1506; 1506 imported 2026-10-30, see below), 1 with a payment that is not whole months (1262), and the 7 collections of those accounts (1271, 864, 599, 385, 1093, 903, 1327). Remaining: admins finalize the draft programs DS-500 (5Y), DCA-400, D-179 and DS-430's total amount payable (25,800 on the old site); delete `legacy-data/` when no longer needed.
- **Export complete (October 8):** 2,139 members, 2,139 New Sales and 1,122 collections, all with details (the export now retries a dropped connection). Staging dry run of the re-run: 52 new members, 65 accounts with their New Sales, 47 collections (32 new payments on accounts imported earlier); 13 New Sales left out as a second sale of the same program for one person (one account per program), listed by old-site record ID in the report. To do: owner runs it on production (dry run, check no unexpected MAS registrations, then `--apply`).
- **Re-runs add only what is new:** members and sales not yet imported, and new payments on accounts imported earlier (checked with every payment the account has now, including ones encoded here since; a receipt already in the database is skipped; the account's status is updated). Tested on staging.
- **Dry run with every member's details (October 8, staging):** 1,980 new members, 2,058 accounts (74 for members already in the database), 1,069 collections; 20 MAS to register (31 spellings, e.g. Jiramy Maglana Puya, 88 records). Nothing has been run on production yet.
- **To do:** owner runs `npm run prod -- node scripts/merge-employees.mjs` (dry run) and `--apply` with the confirmed list; when the export finishes, `npm run prod -- node scripts/migrate-legacy-site.mjs` then `--apply` again to add the rest (the 64 sales whose member is found only by the old site's member ID, records added since October 6). Original plan, for reference: `npm run prod -- node scripts/merge-employees.mjs` (dry run, check the project ref is qnugejonwpfvsenxvhxz), then `--apply`; `npm run prod -- node scripts/migrate-legacy-site.mjs`, then `--apply`; a last export just before, so records staff added on the old site are included; admins finalize the three draft programs (and DS-430's pay-balance total, 25,800 on the old site); review the left-out list; delete `legacy-data/`. The old site holds no payments for the workbook's Legacy Pending accounts (every old-site collection belongs to an old-site New Sale), so it cannot fill those gaps.


## Moving accounts to finalized programs (October 8, 2026)

Admins finalized programs on production (a finalized program has incentive tiers and a total amount payable). Accounts still in draft or legacy programs (many created by the imports) are to move to the finalized program they belong to; several programs look alike by name, code or rate, so the owner confirms every match.
- **Done:** `scripts/list-programs.mjs` (read-only) lists finalized programs and, for each other program, the finalized ones it may be (same rate or a shared number in the code), with account counts. `scripts/move-program-accounts.mjs` (dry run; `--apply`) applies the confirmed matches in `config/program-moves.json`: each account moves with its New Sale, collections and transfers when the member has no account in the target program yet and its payments fit the target's monthly rate; payment status is recalculated; others stay and are listed in `legacy-data/program-moves-left.txt`. Amounts, incentives and remittances already recorded keep what applied then. Staging test (dry run only): D-320 → DS-320 would move 600 of 601.
- **Owner's answers (October 8):** finalized on production: D-180, D-190, D-230, D-280, D-290, D-300, D-300 (BRACKETING); these are the program records the accounts already sit in, so nothing moves for them. D-300 and D-300 (BRACKETING) are different programs; DC-300 is its own program. D-270 (300) is the DC-300 plan, but all 261 of its accounts pay ₱270 a month, which does not fit DC-300 at ₱300: it stays its own program (owner chose this). So no account moves for now; the decisions are kept in `config/program-moves.json`.
- **Finalized programs were empty (October 10, production `list-programs.mjs`):** DP-0061 D-180, DP-0062 D-190, DP-0063 D-230, DP-0066 D-280, DP-0065 D-300 and DP-0067 D-300 (Bracketing) (rates for the later months only; old plans) had 0 accounts, while the members stayed on the old-data drafts DP-0014 (275), DP-0008 (787), DP-0007 (872, no rates), DP-0012 (438, no rates), DP-0033 (72, no rates) and DP-0006 (1,301). **Owner:** move all six into the finalized versions; D-300 (NEW), D-300 (NEW BRACKETING) and DN-300 belong to D-300 (Bracketing); D-150 is D-210 HG. Not the same / own programs: D-390 (300) (the "(300)" marks its ₱300 registration fee), DC-180, D-270 (300), DC-300; D-320 not chosen. `config/program-moves.json` holds the 10 moves (remove the emptied drafts); the applied 290 moves are kept under `applied`.
- **To do (owner):** `npm run prod -- node scripts/move-program-accounts.mjs` (dry run), then `--apply`; then `check-incentive-periods.mjs`, because members now on the old plans whose next payment is in Year 1 have no rate there. Decided (owner): D-350 / D-350 (5Y) / DPB-350 and D-420 / DPB-420 are the same plans with different incentives, kept as separate programs; D-460 and D-460 (59B) are different. The 130 accounts left by the D-300 variant and D-150 moves (member already in the target) are compared by `scripts/compare-double-accounts.mjs` (read-only; `legacy-data/double-accounts.csv`) before any merge. Still open: the ₱480–₱700 programs.
- **Applied on production (October 10):** the six main moves (3,745 accounts; drafts deleted). Comparison of the 130 left: 129 never paid the same month as the member's other account (one enrollment split by the old data: New Sale under "D-300 (NEW)", payments under "D-300 (BRACKETING)"), 1 paid the same months (two accounts). The four remaining moves now merge (`mergeIntoExisting`); a pair with a month paid on both is left. After the move: D-300 (DP-0065) has 15 open accounts in Year 1 with no rate (months 2–12), and DP-0065 D-300 and DP-0067 D-300 (Bracketing) share the code "300" (New Sales pick a program by its code), to be made distinct.
- **D-300 first-year members (owner, October 10):** D-300 (DP-0065) members still in their first year (next payment in months 2–12) move to D-300 (Bracketing) (DP-0067), which has rates for those months; D-300 keeps its members from month 13 on. `move-program-accounts.mjs` now takes `nextPaymentFrom` / `nextPaymentTo` (the next NOP: one after the last posted payment, or 2 after the New Sale alone), and the move merges into a member's existing D-300 (Bracketing) account. **To do (owner):** `npm run prod -- node scripts/move-program-accounts.mjs` (dry run: the 129 merges plus about 15 D-300 accounts), then `--apply`, then `npm run prod -- node scripts/check-incentive-periods.mjs` (D-300 should no longer show open accounts in months 2–12).
- **Two DPB-350 (owner, October 10):** production has DP-0010 (finalized) and DP-0050 (not finalized), both named DPB-350. DP-0050's members move into DP-0010 (merged into a member's existing account there) and DP-0050 is deleted once empty (set inactive if anything is left). The first version picked the programs by "finalized" and found no finalized one on production, so the whole run stopped and nothing moved (likely including the D-300 and merge moves); the config now names DP-0050 → DP-0010. **To do (owner):** `npm run prod -- node scripts/move-program-accounts.mjs --apply`; afterwards move the applied entries under `applied` in `config/program-moves.json`.
- **Decided (owner, October 9, 2026): D-290 and DSP-290 are two programs.** DAYONG 290 (D-290) and DSP-290 both have a ₱500 registration fee; DSP-290 began in August 2026. **D-290 (500) belongs to D-290**, except accounts enrolled from August 1, 2026, which are DSP-290. `config/program-moves.json` does this in two moves, the second removing D-290 (500) once empty. `move-program-accounts.mjs` now takes a program code or name as well as an ID, `doiFrom` / `doiBefore` (split one program by DOI), `fromMatching` (every program containing a text) and `remove` (an emptied program is deleted with its incentive tiers; one still in use is set inactive); the dry run also accounts for earlier moves of the same run.
- **Corrected on staging:** a first, mistaken run (every 290 program into DSP-290) was applied on staging only and fully undone the same day: both accounts and their 11 collections were put back and D-290 (500) was restored from the Audit Log (Record Corrections has the move and the undo). It was never run on production.
- **Staging dry run:** D-290 (500) has 1 account (DOI 2023), whose member already has a D-290 account (DOI 2023, likely a duplicate legacy entry), so nothing moves and D-290 (500) would stay, set inactive. DSP-290 has one account with DOI 1943-08-26 (a birth date typed as DOI) to correct by hand.
- **Production dry run (October 9):** "DSP-290" matches two programs there (DP-0021 and DP-0046), and D-290 is DP-0064 (1 D-290 (500) account would move to it). The script now moves nothing while any name in the config matches no program or several, and lists each match (code, name, rate, accounts, DOI range) so the right program ID can be put in the config.
- **Resolved (production listing):** DP-0021 is the real DSP-290 (485 accounts, DOI to October 2026); DP-0046 is a second program also named DSP-290 on production (D-290 on staging) with 2 accounts enrolled in 2023, so by the DOI rule they belong to D-290 (DP-0064). The config now uses production program IDs: DP-0046 and D-290 (500) each split by DOI into DP-0064 / DP-0021, and both are removed once empty. On staging the config stops (DP-0064 does not exist there).
- **Production dry run with IDs (October 9):** DP-0046 → D-290 would move 2; D-290 (500)'s 1 account was blocked because its member already has a D-290 account. **Owner: move it anyway**, so `move-program-accounts.mjs` has `mergeIntoExisting`: the account's collections join the member's existing account, the combined payments are renumbered NOP 1, 2, 3… in month order (October 4 repair rule), the earlier DOI is kept and the emptied account is deleted; accounts that paid the same month are left. Staging: merged (9 payments, NOP 1–9, January–September 2026, status recalculated) and D-290 (500) deleted.
- **Impossible DOIs (owner, October 9):** `scripts/fix-impossible-doi.mjs` (dry run; `--apply`; `--before=YYYY-MM-DD`, default 2000-01-01) sets the DOI to the New Sale OR (application) date, else the first collection OR date, else the New Sale or first collection Date Remitted, skipping source dates that are themselves impossible; the status is recalculated. Staging: 4 accounts fixed (DSP-290 1943-08-26 → 2026-08-27 from its New Sale Date Remitted, as its OR date was also 1943; DPB-350 1939, D-210 HG 1938, D-350 (5Y) 1992).
- **Confirmed (owner, October 9):** D-290 (500) registered from August 2026 is DSP-290; D-290 is the old program, started 2023. Both DSP-290 moves also merge into a member's existing DSP-290 account.
- **To do (owner), in this order** (the move goes by DOI, so impossible DOIs are fixed first): on production, `npm run prod -- node scripts/fix-impossible-doi.mjs` then `--apply`; then `npm run prod -- node scripts/move-program-accounts.mjs` then `--apply`.


## Accounts hidden from Collections (October 8, 2026)

The Collections page lists a member only under their account's branch and MAS, and offers only the MAS assigned to that branch. An account whose MAS is not assigned to the account's branch therefore cannot be found there. Found after the same-person merge of Kisha Karen Potenciado (BALIOK account; MAS "Bautista, T." assigned only to NABUNTURAN). On staging 677 active accounts of 22 MAS were hidden this way, mostly from the imports (e.g. Mabel G. Baranda at HINATUAN, 286 accounts).
- **Done:** `scripts/assign-mas-branches.mjs` (dry run; `--apply`) adds the missing Employee Branches rows so each MAS is assigned to the branches of their active accounts; accounts and primary branches are not changed. Staging: 34 assignments added; a re-run finds none.
- **Wrong MAS after three merges (found October 8):** the same-person merge kept the kept account's MAS, but 3 of the 27 merged pairs had two different MAS: Kisha Karen Potenciando (now "Bautista, T.", belongs to **Jo-Ann Bautista**, owner), Lourdes Agad Andan ("Tigao, R." vs "Jumawid, Rufina") and Jonalyn Trozo Canono ("Grado, Carlos" vs "Pacios, C."). Owner: put back their previous MAS (the other account's). Kisha was transferred in the app; `scripts/fix-merge-mas.mjs` (dry run; `--apply`) does the other two from the merge records: sets the merged-away account's MAS, writes a Member Transfers row, and assigns that MAS to the account's branch if needed; it skips accounts transferred since the merge. Staging: Andan → Jumawid, Rufina and Canono → Pacios, C., both visible in Collections. `merge-name-variants.mjs` now leaves a pair whose accounts have different MAS unless the pair says `"mas": "keep"` or `"other"`.
- **Done on production (owner, October 9):** `fix-merge-mas.mjs` (Kisha Karen Potenciando → Jo-Ann Bautista, Andan → Jumawid, Rufina, Canono → Pacios, C.) and then `assign-mas-branches.mjs`, both applied. Kisha's surname is POTENCIANDO (owner, October 9), corrected in Members → Edit (PH-61713918).

### October 13, 2026: member program correction
PH-25541018 is enrolled only in D-350 (5Y) (DP-0009). Production correction moved OR 09522 B to that account and deleted the empty D-350 assignment. Payments now run NOP 2–5 in OR-date order (OR 14368 B is NOP 5, August 2026); status recalculated to 60D. Staging and production dry runs passed before applying; production readback verified the result. Audit Log and Record Corrections retain the changes; config/receipt-consolidations.json records the applied case.

### October 13, 2026: clearing removal
Removed clearing CLR-20261013022919-CXXZ (NABUNTURAN, DNDO-2026-0042, PHP 900, note 20 FB) in production at the owner's request; verified Removed status, Audit Log and Record Corrections. The row was absent from staging; production dry run rolled back before applying. Clearing's Remove reason and confirmation form now opens directly under the selected row, focuses the reason field and displays removal errors there. ESLint, TypeScript and the existing clearing ownership/removal test passed. UI change awaits deployment.

### October 13, 2026: duplicate employee MD-2026-0084
Owner confirmed MD-2026-0084 duplicates MD-2026-0063. scripts/merge-employee-pair.mjs performs a scoped, audited transaction with dry-run rollback and --verify; retains the original login and permissions, reassigns employee/user references and matching names, and refuses conflicting attendance/pay profiles/report-note keys. Staging lacked the duplicate. Production dry run succeeded before applying: removed the duplicate employee, login USR-0071, redundant branch assignment and identical October 13 Day Off attendance row. Original MD-2026-0063 and login USR-0060 retained. No transaction references needed reassignment; all were already under the original. Audit Log and Record Corrections retain the merge; config/employee-merges.json records the applied pair.

### October 13, 2026: incentives follow Clearing receipt time
Fixed receipt-time lookup so a later-day clearing covering an earlier Date Remitted remains usable after it becomes Encoded. Remittances totals use each outstanding/returned batch's receipt time and retain pending slips' saved amounts, rather than forfeiting incentives as the clock advances. Tests cover late encoding, the exact 3 PM cutoff, both entry kinds, Removed/future clearings and stable pending totals. All 127 encoder/remittance tests, TypeScript and targeted lint passed. scripts/restore-clearing-incentives.mts previewed staging (no cases) and production before applying seven pending-slip corrections: PHP 1,840.50 restored, original slips retained as Rejected, replacement slips Pending Approval. Production readback verified zero forfeiture and balanced totals on all seven, with Record Corrections summaries. Two genuinely late slips were unchanged.

### October 13, 2026: GOTUAL daily incentive correction
Owner confirmed MD-2026-0053's incentive for October 13 must be PHP 196.50. Corrected today's stored collection snapshot only: OR 17111B (D-350 (5Y), NOP 9) PHP 122.50, plus OR 17112B (D-370, NOP 44-45) PHP 74.00. The first payment had been calculated at a zero Collector rate; this correction records a 35% snapshot without changing program-wide tiers. Pending slip REM-20261013085527-WKVX and its mapping now agree at PHP 915.00 including PHP 21.50 Fidelity. scripts/fix-gotual-incentives.mjs ran as a production dry run before applying and verifies the daily total, balanced slip, mappings and Record Corrections. Staging did not have the same pending entries. All changes retained in Audit Log and Record Corrections.

### October 13, 2026: TANGAL incentive correction
Owner subsequently requested fixing TANGAL, MARY JEAN's MATINA entry encoded by ABESIA, DARYL JANE, superseding the earlier leave-as-is decision. OR 17552B (COL-20261013081610-4ARZ), D-320 NOP 29, kept its encoded Collector role and was recalculated using the now-configured 10% tier: PHP 32.00 incentive, PHP 288.00 remittance. Pending slip REM-20261013081611-ZVKX and its mapping were updated together in one audited transaction, with a Record Corrections summary. scripts/fix-tangal-incentives.mjs passed a production rollback dry run before applying; readback verified incentive, balanced slip/mapping and correction record. Staging did not have this entry.

### PH-33970911: missing month on first PHP 420 receipt (October 19, 2026)

Owner requested correction. Account already solely D-210 HG/DP-0005, ENR-LEG-F68146AD58. Original M1-COLL row 791 explicitly records December-January/NOP 26-27 on PHP 420 OR 5478 M, imported as December only. Rows 3466,4594,5898,6318,8313,9176 confirm February-July/NOP 28-33. Exact hash of source row 9176 matches this member's 13318 B (duplicated), distinguishing other member's repeated OR on row 9177. Saved complete backup, then existing consolidation script/config/ph33970911-two-month-start-20261019.json passed rollback dry run and applied. First receipt now December 2025-January 2026/NOP 26-27, subsequent receipts February-July 2026/NOP 28-33. Seven receipt amounts/PHP 1,680, dates, duplicate label, November 1, 2023 DOI, program and attribution preserved. Status recalculated to 60D based on July last coverage. Seven financial snapshots recalculated with no net incentive change or linked slip adjustments. Audit Log and Record Corrections retain the repair.

### PH-34342562: legacy coverage and later receipt corrected (October 19, 2026)

Owner requested correction of D-210 HG account ENR-LEG-2FE5A09309/DP-0005. Original SDS-COLL row 177 says OR 4571 covers August-October; its NOP 16-18 is shifted. Row 815 (numeric OR 4649, stored 4649 S) says November-December/January, NOP 17-19; rows 2119,2672,3660 confirm February-April/NOP 20-22, May/NOP 23 and June-August/NOP 24-26, all aligning to July 1, 2024 DOI. Restored August 2025-August 2026/NOP 14-26 on legacy receipts and carried October 17 receipt 03247 S/PHP 420 back to September-October 2026/NOP 27-28. Saved backup; existing consolidation script/config/ph34342562-source-coverage-20261019.json passed rollback dry run then applied. Preserved six receipts/PHP 3,150, dates, labels, DOI, program and attribution. Status U; six financial snapshots recalculated without net incentive change or linked slip adjustments. Verified all receipts, complete history and total. Pending slip REM-20261019054636-TNC8 remained Pending Approval, expected/actual PHP 1,180, difference zero, and all three mapping amounts unchanged (including this member's PHP 420). Audit Log and Record Corrections retain the repair.

### PH-11741830 merged into PH-71670920 (October 19, 2026)

Owner explicitly requested merge, stating PH-11741830 does not exist as a separate person. Both records existed in production. Kept PH-71670920 (MEM-LEG-680DA2423A), D-230 account ENR-LEG-5609D45070; other account ENR-LEG-5CDD86AA5A had only September OR 24425 C/NOP 61. Both share September 1, 2021 DOI, MINTAL and same MAS; September continues kept January-August/NOP 53-60 without overlap. Saved complete member/account/financial backups; member-accounts.mjs --backup now includes the full member record. Existing merge-name-variants.mjs/config/ph71670920-ph11741830-merge-20261019.json passed rollback dry run, then applied. Preserved kept personal details (fillDetails false), moved the September receipt and removed redundant account/member. Nine receipts/PHP 2,070, dates, coverage/NOPs, program, DOI and MAS preserved. Status U; nine financial entries recalculated. Production verification confirmed all nine receipts under one kept account and zero member records for PH-11741830. Audit Log and Record Corrections retain the merge.

### PH-21465590: all D-280 and PHP 230 amount correction (October 19, 2026)

Owner explicitly requested all entries under 280 and changing PHP 230 to PHP 280. Production had eight D-280 receipts and one D-230 receipt, 18140 C. Saved full account/history backup. Extended existing consolidation script with guarded amountCorrections (exact collection ID, OR, expected old amount and reason); amount, account move, coverage and financial updates share the same audited transaction. Config/ph21465590-all-d280-20261019.json passed rollback dry run and applied. OR 18140 C is now PHP 280 under D-280/DP-0066, kept account ENR-LEG-4C1D7DBB0F; empty D-230 account removed. Nine PHP 280 receipts total PHP 2,520, up PHP 50 as instructed. Restored January-September 2026/NOP 26-34, preserving December 1, 2023 DOI, receipt dates, branch and MAS. Status U. Nine financial snapshots recalculated; no linked remittance expectations changed. Production receipt-count/total/program/history verification and script syntax check passed. Audit Log and Record Corrections record the before/after amount, program and coverage.

### Source-confirmed NOP-only sweep (October 19, 2026)

Owner requested finding/fixing NOP issues like PH-84237783. Added --nop-only audit mode: complete source receipt identities, dates/amounts, existing covered months and month counts must agree; NOPs align to preserved DOI and at least 80% of later source NOP ranges. Excluded explicit coverage/NOP exceptions, multiple-account members and prior corrections other than the earlier Month of-only sweep. Scanned 14,228 accounts/64,111 posted receipts; found 43 accounts/363 NOP corrections. Extended existing guarded repair with --nop-only: saved full backup, passed rollback dry run, then applied in one transaction. Changes NOPs and NOP-dependent finance snapshots only; covered months, amounts/dates, programs, DOIs, branch/MAS attribution, ownership and remittance links/status remain intact. No mapped remittance receipts are allowed in this sweep. All 363 finance snapshots recalculated with zero net incentive change and zero remittance slip changes. Both in-transaction and post-commit verification passed against complete backups and pricing results. Receipt total PHP 106,395 preserved. Per-account COR-NOP-20261019-* Record Corrections and Audit Log retain changes. Existing 39 U, 2 60D and 2 ADV statuses preserved by the coverage-based recalculation. Source parser tests and syntax checks passed. Full member/NOP list: docs/source-nop-corrections-20261019.md.

### PH-84237783: owner-confirmed NOP 3 start (October 19, 2026)

Owner explicitly requested NOP starts at 3. After saving backup and rollback dry run, applied existing consolidation script/config/ph84237783-nop3-20261019.json to DPB-350 account ENR-LEG-12FC5AA43F/DP-0010. OR 11374 C January 2026 is now NOP 3; subsequent receipts continue through September/NOP 11. Two-month payments 20120 C and 23585 C now cover NOP 8-9 and 10-11. January-September coverage, November 1, 2025 DOI, all seven dates/PHP 3,150, branch/MAS and 14529 C duplicate label preserved. Status U. Seven financial snapshots recalculated without net incentive change or linked slip adjustments. Audit Log and Record Corrections retain the repair.

### Source cross-year and month-count follow-up (October 19, 2026)

Owner requested finding/fixing similar issues again after PH-88243657. Expanded source audit with --prior-year and --source-spans, using conservative explicit-year parsing, full source identity checks, single-account histories, continuous covered months and at least 80% later-source NOP agreement with preserved DOI. Found/fixed five accounts after fresh backups and rollback dry runs: PH-10533517 (24862 C August-September), PH-50599167 (23600 C August-September), PH-80857861 (06766T July-August), PH-97019970 (06164T July-August; 08021T September-October), PH-70844674 (source one-month January-July receipts followed by August-November on 15617 B; removed imported extra coverage through May 2027). Thirteen month/NOP ranges changed. Verified all 37 receipts/PHP 11,280, dates, programs, DOIs, attribution, totals and remittance links/status against backups and source plans. Four statuses U; PH-70844674 ADV through November 2026. Financial snapshots recalculated with no net incentive changes or linked slip adjustments. Audit Log and Record Corrections retain all repairs. Three source-parser regression tests and syntax checks passed. Full report: docs/source-span-corrections-20261019.md. Scoped configs: ph10533517-two-month-receipt-20261019.json and four-source-span-fixes-20261019.json. Other ambiguous histories left unchanged.

### PH-88243657: D-320 coverage correction (October 19, 2026)

Owner requested correction. Original M3-COLL row 1434 explicitly records PHP 640 OR 10911 C for December 2025-January 2026 (written January, Deccember 2025); its source NOP 40 is inconsistent. Rows 3002,4410,6611,8565,10431,12792,14316,16315 confirm February-September/NOP 24-31, matching March 1, 2024 DOI. Stored February-November/NOP 24-33 was wrong. After account/history backup and rollback dry run, applied existing consolidation script/config/ph88243657-d320-coverage-20261019.json: OR 10911 C December-January/NOP 22-23, remaining receipts February-September/NOP 24-31. Program DP-0011/D-320, DOI, all nine dates/PHP 3,200, branch and MAS preserved. Status U. Nine financial snapshots recalculated with no net incentive change or linked slips. Production receipt-count/total/program/history verification passed. Audit Log and Record Corrections retain the repair.

### PH-24403007: three months on OR 22547 N (October 19, 2026)

Owner supplied seven receipts for D-300 (Bracketing), account ENR-LEG-1B4FC12E28/DP-0067. Original DDO 1-COLL row 6610 says PHP 900 OR 22547 N covers June, July, August, but NOP 24,25,25 was imported as only two months. Row 8017 confirms OR 25090 N September/NOP 27. Saved pre-change backup, ran existing consolidation script/config/ph24403007-three-month-receipt-20261019.json as rollback dry run then applied. OR 22547 N now covers June-August/NOP 24-26; OR 25090 N September/NOP 27. First five payments retain January-May/NOP 19-23. Full January-September history verified: seven receipts/PHP 2,700, July 1, 2024 DOI and dates preserved; status U. Seven financial snapshots recalculated with no net incentive change or linked slips. Audit Log and Record Corrections retain the repair.

### Source-confirmed Month of sweep (October 19, 2026)

Owner requested another check and repair of Month of issues. scripts/audit-source-month-coverage.mjs compared 14,227 accounts/64,107 posted receipts against 62,424 indexed original workbook rows. Conservatively selected 74 accounts with complete, continuous January-start 2026 source histories; every matched row agrees on deterministic source ID, receipt number, OR date, amount and month count. Excluded earlier corrected histories, incomplete/ambiguous matches, noncontinuous source sequences and histories with fewer than six receipts. Found 629 changed covered-month ranges across 74 members; all 629 payment amounts total PHP 179,200.

scripts/repair-source-month-coverage.mjs locked and rechecked the reviewed records, saved a full pre-change backup, passed a rollback dry run, then applied in one production transaction. Changed only collections.month_from/month_to and member_programs.account_status; preserved NOPs, DOIs, program/enrollment/member links, dates, attribution, every financial snapshot and remittance field. Created 74 Record Corrections entries and retained database Audit Log changes. In-transaction verification and independent post-commit --verify both compared all other fields against the backup and passed: 74 accounts, 629 changed receipts. Script syntax checks passed. Report and full member list: docs/source-month-corrections-20261019.md. Final calculated statuses: 69 U, 3 60D and 2 ADV, according to actual source coverage. Other source ambiguities remain untouched.

### PH-29085041: Month of correction (October 19, 2026)

Owner requested Month of correction. D-270 (300) account ENR-LEG-3EBA110F22/DP-0015 had nine PHP 270 receipts with shifted February-October coverage. M3-COLL rows 2615,4489,6169,8540,10788,12795,16298,16966 explicitly cover February-September on the eight later receipts, supporting January-September for the full sequence. After backup, existing consolidation script/config/ph29085041-month-of-20261019.json passed rollback dry run then applied. Explicit coverageStart corrected months to January-September 2026 while preserving NOP 28-36 and November 1, 2023 DOI, as requested for Month of only. Receipt dates, amounts, program, branch and MAS unchanged. Nine financial snapshots recalculated with no net incentive change or linked slips. Read-only verification passed nine receipts/PHP 2,430, complete history and status U. Audit Log and Record Corrections retain the repair.

### Four confirmed D-210 HG split histories fixed (October 19, 2026)

Owner approved the four shortlisted cases. Saved fresh pre-change backups; existing consolidation script/config/four-d210-split-fixes-20261019.json passed a full rollback dry run and then applied in one transaction. Moved 5075 M (PH-15674914, D-250 FG), 24468 C (PH-50305112, DC-260), 11669 C (PH-60372421, D-300 Bracketing), and 21993 C (PH-60651860, D-300 Bracketing) into each member's existing D-210 HG account and deleted the four empty source accounts. All statuses U. Coverage: PH-15674914 January-October/NOP 17-26; PH-50305112 January-September/NOP 18-26; PH-60372421 January-September/NOP 8-16; PH-60651860 January-September/NOP 18-26, including June-July on 18635 C. Read-only scripts/verify-four-d210-splits-20261019.mjs compared all 36 receipts/PHP 9,720, dates, coverage, NOPs, DOI, attribution and remittance links/status against the backups and verified correction records. Financial snapshots recalculated with no net incentive changes or linked slips. Audit Log and Record Corrections retain changes. Other 15 targeted scan candidates remain for review.

### Similar member-history scan (October 19, 2026)

Owner asked to find cases similar to recent corrections. Read-only production scans covered 14,231 accounts and 64,106 posted receipts. Added scripts/find-d210-split-histories.mjs: found 19 D-210 HG accounts with matching-DOI minority histories on another program and no same-day parallel receipts; four have continuous NOPs across accounts (PH-15674914, PH-50305112, PH-60372421, PH-60651860). Original workbook rows confirm mixed program labels in all four, so intended program still needs owner confirmation. No database corrections applied. Related-family scan found 209 member/family candidates (33 strong patterns, 54 continuous sequences); broader equal-rate scan found 122 split sequences, no program disagreements or amount-matching candidates. Coverage screen found 572 possible shifts, not confirmed errors. Counts overlap and must not be added. Review details, source references and all 19 targeted candidates: docs/member-data-review-20261019.md. Targeted scanner ran successfully against production and passed syntax validation.

### PH-17990283: all payments under D-210 HG (October 19, 2026)

Owner confirmed all entries under 210. After saving account/history backup, ran the existing consolidation script with config/ph17990283-all-d210hg-20261019.json as rollback dry run then applied. Moved OR 12652 C from D-300 (Bracketing) to D-210 HG (DP-0005), kept account ENR-LEG-6E20B12160 and removed empty ENR-LEG-FF87FA7E94. Restored continuous January-September 2026/NOP 15-23; PHP 500 OR 22586 C retains two months, July-August. All eight recorded amounts total PHP 2,410; amounts, dates, November 1, 2024 DOI, branch and MAS preserved. Status recalculated to U. Eight financial entries recalculated with no net incentive change or linked slip changes. Production readback verified one D-210 HG account and all eight receipts with complete coverage. Audit Log and Record Corrections retain the repair.

### PH-95756414: D-300 (Bracketing) source coverage (October 19, 2026)

Owner supplied nine receipts from 10091 C through 24082 C. Original M3-COLL rows 788,2404,4650,7517,9413,11158,13515,15616,16984 explicitly cover January-September 2026, while stored coverage was February-October. After account/history backup and rollback dry run, applied the existing consolidation script with config/ph95756414-source-coverage-20261019.json. Restored source months with explicit coverageStart, retaining source initial NOP 2 and the existing continuous NOP 2-10; the source's repeated NOP 3 and subsequent offset were normalized. Preserved January 1, 2026 DOI, program DP-0067, all receipt dates, nine PHP 300 amounts (PHP 2,700 total), branch and MAS. Status U retained. Nine financial entries recalculated with no net incentive change or linked slip changes. Production verification passed receipt count, program, total and complete January-September history. Audit Log and Record Corrections retain the repair.

### PH-34460062: paired D-190 and DFPP-650 receipts (October 19, 2026)

Owner supplied receipts 3747,3748,1020 S,1021 S,1827 S,1828 S. Saved a pre-change account/history backup. D-190 correctly covers January-September 2026/NOP 59-67; its stale status was corrected to U using the existing consolidation script/config/ph34460062-two-programs-20261019.json after a rollback dry run. Three PHP 570 amounts, dates, DOI and MAS preserved; financial recalculation had no net incentive change or linked slips.

DFPP-650 completed after owner replied "follow the source" to the question about starting NOP 32-34 versus DOI-derived 59-61. Used source January-September 2026 coverage with sequential NOP 32-40: 3748 January-March/NOP 32-34, 1020 S April-June/NOP 35-37, 1827 S July-September/NOP 38-40. The final source row's inconsistent 65-67 was normalized to continue this account's sequence. Explicit coverageStart preserves source months without changing the March 2021 stored DOI. A prior full dry run with NOP 59-67 failed at the missing tier after 60 and rolled back entirely. Owner-confirmed config then passed a rollback dry run, applied, and verified three receipts totaling PHP 5,850 and status U. Receipt amounts, dates, distinct MAS, existing financial snapshots and remittances were preserved. Audit Log and Record Corrections retain the repair. D-190's already-applied case is retained under previouslyAppliedCases so it is not rerun.

### PH-08354649: D-230 and D-210 HG receipts (October 19, 2026)

Owner supplied eight receipts and confirmed the two programs. OR 480 S was incorrectly on a separate D-460 account. Original SDS-COLL row 977 confirms PHP 460 covers February-March 2026/NOP 48-49; rows 1983,3264,3868 continue D-230 through September/NOP 55. After saving an account/history backup, ran the existing consolidation script with config/ph08354649-two-programs-20261019.json as a rollback dry run and then applied. Moved 480 S to D-230 (DP-0063), restored its two-month coverage, and removed the empty D-460 account. D-210 HG (DP-0005) retains January-August 2026/NOP 21-28, two months per PHP 420 receipt, confirmed by SDS-COLL rows 976,1984,3263,3869. Both statuses recalculated to U. Production verification passed four receipts per account, totals PHP 1,840 and PHP 1,680, expected programs and complete histories. Amounts, receipt dates, DOIs, branch and MAS were preserved. Eight financial entries recalculated with no net incentive change or linked slip changes. Audit Log and Record Corrections retain the repair.

### PH-07624278: paired D-300 (Bracketing) and D-350 receipts (October 19, 2026)

Owner supplied 18 receipts for the two programs. D-300 (Bracketing), ENR-LEG-13FF9B23B3/DP-0067, already had correct January-September 2026/NOP 2-10 coverage. D-350, ENR-LEG-812A392CDE/DP-0013, incorrectly had December 2023-August 2024/NOP 15-23. Original M3-COLL rows 806, 2650 and 16246 confirm January/NOP 40, February/NOP 41 and September/NOP 48, consistent with its October 1, 2022 DOI. After a pre-change backup and rollback dry run, applied the existing consolidation script with config/ph07624278-two-programs-20261019.json. Restored D-350 to January-September 2026/NOP 40-48 and recalculated both statuses to U. Verified nine receipts per program, totals PHP 2,700 and PHP 3,150, and last coverage September 2026. Dates, amounts, DOIs, account ownership and the 10118 C (duplicated) marker were preserved; other members' repeated receipt numbers were untouched. Financial snapshots recalculated with no net incentive change or linked slip changes. Audit Log and Record Corrections retain the repair.

### PH-29162192: all payments under D-210 HG (October 19, 2026)

Owner requested all entries under 210. Production had eight D-210 HG payments and one D-350 payment, OR 23438 C. After saving an account/history backup, the existing consolidation script ran with `config/ph29162192-all-d210hg-20261019.json`, first as a rollback dry run and then applied. All nine receipts now belong to D-210 HG (DP-0005), account ENR-LEG-0FB73A1145; the empty D-350 account was removed. August 1, 2024 DOI, January-September 2026 coverage/NOP 18-26, OR dates, recorded amounts (PHP 2,450 total), branch and MAS were preserved. Status recalculated to U. Nine financial entries were recalculated with no net incentive change or remittance expectation changes. Production readback verified the single account and all nine receipts. Audit Log and Record Corrections retain the changes.

### Duplicate remittance correction (October 17, 2026)

REM-20261017074154-GUDN could not be approved because two overlapping submissions attached the same New Sale to separate slips. REM-20261017074155-FU2X had already been approved for PHP 220 and held the sale's Remitted link. Production correction `scripts/fix-rem-gudn-duplicate.mjs` passed a rollback dry run, retired only GUDN as Rejected with a duplicate explanation, and recorded COR-REM-GUDN-DUPLICATE. The approved slip, sale, mappings and cash amounts remain intact; repeat verification passed. `scripts/inspect-remittance-approval.mjs` provides read-only investigation by slip ID.

Submission now locks the selected New Sales or Collections inside the write transaction and rechecks their live Outstanding status and empty remittance link before creating a slip. A second overlapping request stops before writing. The approval guard remains in place. All 204 tests passed, including regression coverage for both entry kinds and automatic submission; TypeScript and targeted lint also passed. Code change awaits deployment.

### Attendance fixes (2026-10-17)

- **Done:** shift progress on the clock-in page uses the server's clock (the one that records the clock-in), not the device's. A device clock a few minutes slow kept someone who clocked in at 8:00 below 100% at 5:00 PM. The progress math itself was already right (8:00 to 17:00 less lunch is 8 hours).
- **Done:** No attendance needed carries over. When the system closes a day, an employee with no record whose latest earlier day was No attendance needed gets No attendance needed again (note "carried over from <date> by the system") instead of Absent by system, so they are no longer flagged. It stops when they clock in or management marks the day otherwise. Attendance Review shows "No attendance needed · carried over" for today before the day closes. The about 30 marked on October 16 are carried to October 17 when it closes. No migration.
- **To do (owner):** to end someone's carry-over without a clock-in, mark that day Absent, AWOL or Day Off in Attendance Review.

### Report cash flow totals, expense receipt rules, attendance sheet people (2026-10-20)

- **Owner:** monthly and yearly reports' cash flow should be the total of each week / month; expenses require the receipt number, and Cash Burial Assistance the member or deceased member's name; the attendance sheet should let them choose which people it shows.
- **Done:** Cash Flow Transaction on monthly reports is one row per week, on yearly one per month, each its total (`depositTotals` in `lib/clerk-report.ts`); daily and weekly still list each deposit and are where deposits are edited or voided.
- **Done:** receipt number required on every expense (Expenses page and clerk report, create and edit; `expenseNumbers` in `lib/expense-options.ts`). Cash Burial Assistance requires the member / deceased member name, saved in the existing `payee` column, so no database migration.
- **Done:** Attendance sheet → **Choose people**: tick the employees to show; kept in the browser (`dayong-attendance-sheet-people`); none ticked = everyone.
- **To do:** none. Expenses saved before today without a receipt number must get one when they are next edited.
- **Owner (follow-up):** apply the attendance sheet's filters to Payroll's runs and pay rates.
- **Done:** the filters are now one shared component, `components/people-filter.tsx` (Choose people, role, branch, search), used by the attendance sheet, the Employees table and Adjustments list of a payroll run, and Pay rates. The ticked people are shared by all three. Filters only narrow what is shown; a run's totals, approval and payment stay whole. `getPayrollOverview` now also returns each employee's primary branch.

### No incentive on one New Sale or Collection (2026-10-20)

- **Owner:** in Collections and New Sales, a No incentive button on each entry: that one entry earns the collector (or MAS) no incentive, and the reason is asked.
- **Done:** each entry has a **No incentive** button. Clicking it opens a required reason box. The entry is remitted whole, and what it would have earned is recorded as forfeited, so the control total includes the whole amount. Repricing, returned-batch edits and rejected slips keep it so. Today's Entries, My Entries and Remittances → View entries show the reason. New column `no_incentive_reason` on `sales` and `collections` (migration 0025). Details in `docs/collections-remittance-workflow.md`. Tested.
- **Done:** migration 0025 applied to production by the owner (2026-10-20), checked with `scripts/check-database.mjs`.
- **To do:** none. Push to `main` to deploy.

### Receipt photo required on report expenses (2026-10-21)

- **Owner:** an expense recorded on the Entry Clerk's report must have a file or photo of its receipt attached.
- **Done:** the report's expense form has **Photo of the receipt** (the New Sales / Collections photo picker, `components/receipt-photos-picker.tsx`, with its own wording). At least one photo is required to save, up to 10 (`MAX_EXPENSE_PHOTOS`). `add-expense` in `app/api/clerk-report/route.ts` checks the photos (`expensePhotosFrom`), saves them under a pre-made expense ID (`saveExpensePhotos`), then saves the expense with that ID (`createExpense(input, id)`), so no expense is saved without a photo. `edit-expense` can add photos and needs one when the expense has none.
- **Done:** each expense on the report shows **Receipt** buttons for its photos (`photoIds` on `ExpenseRow`, from `expensePhotoIds` in `lib/receipt-photos.ts`), or **No receipt photo** for older ones. Photos use the existing `receipt_photos` table and Storage bucket, so no database migration. Tested.
- **In progress:** none.
- **Owner (follow-up):** require it on the Expenses page too.
- **Done:** the rule is now in `createExpense` (`lib/finance-data.ts`), used by both forms: fields and photos are checked, photos saved, then the expense row; a refused expense stores no photo. The Expenses page form has the photo picker, its register shows **Receipt** buttons (`photoIds` from `GET /api/expenses`), and `/expenses` may view receipt photos. Tested.
- **To do:** none. Expenses saved before today keep no photo; one is asked for when an expense is next edited on the report (the Expenses page has no edit).

### App pop-up boxes in place of the browser's (2026-10-21)

- **Owner:** replace the browser's pop-ups (the plain boxes at the top of the page) with better ones that do not appear at the top.
- **Done:** `components/app-dialog.tsx`: `confirmDialog`, `promptDialog` and `alertDialog` return promises like the browser's confirm, prompt and alert, and `AppDialogHost` (mounted once in `app/layout.tsx`) shows them one at a time, centred over a dimmed page. Every `window.confirm`, `window.prompt`, `confirm` and `alert` in the app now uses them: about 20 confirm and prompt boxes (delete, void, reject, reset password, payroll, Fidelity, transfers, drafts, calendar, NTE) and 22 Programs warnings. Reason prompts the server requires use `required: true`, so OK stays off until something is typed. No server or database change. Build and tests pass.
- **In progress:** none.
- **To do:** none.
- **Owner (follow-up):** when the Entry Clerk clicks Preview in Collections and New Sales, a pop-up reminding them, firmly, to double-check every entry before saving.
- **Done:** `alertDialog` gained `warning` (amber triangle, capitalised heading, closed only with its button). Preview Collections and Preview Sales (clerk only, not MAS submitting) show `COLLECTION_CHECK_REMINDER` / `SALE_CHECK_REMINDER` from `lib/entry-check-reminder.ts` before the preview opens. Build passes.

### Revert attendance marks (2026-10-21)

- **Owner:** a Revert button on the employees marked in attendance.
- **Done:** `revertMarks` in `app/api/attendance-tracking/daily/route.ts` (PATCH, action `revert`, employee IDs, date, required reason). Today: the marked row is deleted (`deleteRowsWhere`, found again by employee, date, no clock-in and a mark status; Audit Log keeps it), so the employee is Not clocked in yet. Earlier day: the record becomes Absent by system with `<mark> mark reverted by <name> on <date>: <reason>` after the system note, so payroll still counts it. System absences, clock-ins and leave are skipped and reported. Daily board: **Revert** per marked row and **Revert N marks** for ticked rows; Attendance Review: **Revert** beside the mark. Both ask the reason in the app pop-up. Tested; no migration.
- **In progress:** none.
- **To do (owner, optional):** a mark reverted on the same day leaves no attendance record, so its reason is not stored; the Audit Log shows only that the row was removed and by whom. Say if the reason must be kept too.

### Deleting a remittance with its entries (2026-10-21)

- **Owner:** entries and remittances deleted by the admin still appear in the report, and the OR check flags their OR numbers as duplicates.
- **Found:** an entry deleted on its own is removed (reports and Exceptions read live data). Deleting a remittance, by design, removed only the slip and set its entries back to Outstanding, so they stayed in the clerk's report and kept their OR numbers. Record Corrections shows remittances deleted on October 16 ("Duplicate", "Duplicate entries") and six on October 21 ("adjustments."), each with no entries deleted.
- **Done:** `planDeletion` / `deleteRecord` in `lib/admin-delete.ts` take `withEntries` for a remittance: the slip, its `remittance_collections` and Fidelity, and its New Sales and collections (each with the usual cascade) go in one transaction; its own remittance no longer blocks deleting its entries. The delete panel (`components/admin-delete.tsx`) makes the administrator choose "remittance only" or "remittance and its entries" before Delete permanently appears. Logged as `Delete remittance with its entries`. Tested.
- **In progress:** none.
- **To do (owner):** the entries released by the October 16 duplicate deletions are still in the database as Outstanding. Find them (Today's Entries / Exceptions → Possible duplicates) and delete each duplicate on its own (Delete permanently on the entry). Production was not changed.

### Receipt photo viewer no longer scrolls the page behind it (2026-10-21)

- **Owner:** scrolling while viewing a photo also scrolled the page, so it was moved when the photo closed.
- **Done:** the page scrolls in the app shell's main area (`.app-main`), not the body, so the viewer's body lock did nothing. `ReceiptPhotoView` (`components/receipt-photo.tsx`) now locks the body and `.app-main` while open and restores them on close, and the viewer stops scrolling at its own edges (`overscroll-contain`). Build passes.
- **Owner (follow-up):** but the photo itself cannot be scrolled.
- **Done:** the viewer opened fitted to the screen (nothing to scroll), and zoomed photos sat in a flex row that stretched them to the screen height, so they never scrolled up and down. It now opens at the screen width (at most 56rem) in a block container, so tall receipts scroll vertically; zoom steps are Fit (whole photo), 1× (opens here), 2×–4×; a click on the photo toggles 1× and 2×. Build passes.
- **Owner (follow-up):** still not working.
- **Done (the real cause):** cards in `main` have `backdrop-filter` (glass), which makes a card the containing block of any `position: fixed` element inside it. The viewer opened inside a card was placed and clipped in that card, not the screen, so it never scrolled properly. `ReceiptPhotoView` now renders the viewer with `createPortal` on `document.body`, as the payslip overlay in Payroll already does. Build passes.
- **In progress / To do:** none.

### Registration-fee programs start at NOP 1 (2026-10-21)

- **Owner:** a program with a registration fee starts at NOP 1; without one at NOP 2. Fix accounts already numbered by the old rule. Answers: NOP 1 is the month after DOI (only the numbering changes); renumber and recompute incentives, approved remittances untouched.
- **Done:** `saleNops` / `firstCollectionNop` in `lib/account-rules.ts` (`Account.registrationFee`, loaded from `programs.registration_fee_required` in `lib/account-data.ts`). `accountState` starts the NOP at 0 for a registration-fee account, so its next NOP is 1; the next month is unchanged. `renumber` maps NOP n to the DOI month plus (n - saleNops); merges, collection edits, New Sale program changes and program transfers keep months when the two programs differ in registration fee (NOPs shift by one). Tests for the rule and renumbering; 215 pass; build passes.
- **Done:** `scripts/fix-registration-fee-nops-20261021.mts`: finds accounts of registration-fee programs whose collections follow the old numbering (first month = DOI month + NOP - 1), checks the renumbered history passes the account rules, lowers every NOP by 1 (months unchanged) and reprices collections not on an approved remittance (`repriceCollections`; pending slips follow). Accounts already on the new numbering are left; ones that fit neither way, or would break the rules, are listed and left. Preview on staging: no such accounts there.
- **In progress:** none.
- **To do (owner):** preview on production, check the counts and the lists, then apply:
  - `node scripts/prod.mjs node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/fix-registration-fee-nops-20261021.mts`
  - the same with `--apply` at the end. Deploy the code change first or together, so new collections follow the new numbering.

### Program moves keep Month of and NOP (2026-10-21)

- **Owner:** transferring to another program mixes up Month of and NOP; fix it and the affected accounts.
- **Found (from the code; production reads were blocked):** `renumber` worked months out from the DOI (NOP n = DOI month + n - 1). On accounts whose DOI and NOPs do not line up (most from the old system) every renumbered month shifted. It runs on program transfers with a different pay, merges into the member's existing account, and collection moves between accounts. Changing a New Sale's program moved the account as it was, so with a different pay the receipts kept their old month counts.
- **Done:** `numberingStart` and a new `renumber(start, payments, count)` in `lib/entry-edit.ts`: numbering starts at the account's lowest NOP and that payment's own first month (no payment: first collection NOP and the month after DOI). `receiptMonthsAt` (moved from `lib/program-transfer.ts`) is shared; a New Sale program change now counts receipts again at the new pay like a transfer. Tests; 215 pass; build passes.
- **Done:** `scripts/fix-program-move-months-20261021.mts`: for every account holding a collection moved between programs since October 1 (Audit Log), numbers the payments again from the current lowest NOP at the month that payment covered before its first move, with receipts counted again at the current pay where the original program differed; the history must pass the account rules or the account is listed and left. Reprices changed collections not on approved remittances, recalculates the account status, logs "Program move months" in Record Corrections. Staging preview: 26 moved collections on 10 accounts, all already right.
- **In progress:** none.
- **Done (owner, 2026-10-21):** applied on production: 483 collections on 72 accounts renumbered, 233 with new incentives (the others were on approved remittances, which keep their figures, or their incentive did not change); no remittance slip needed to follow. Logged in Record Corrections as "Program move months".
- **Owner (2026-10-21):** the registration-fee script stopped on production with nothing saved: COL-LEG-285C9E8D36 has no single MAS incentive tier for its new NOP 7 in its branch.
- **Done:** the script now prices one collection at a time; one its program's tiers cannot price keeps its figures and is listed (program, branch, NOP, why), and the NOPs are still fixed. The preview runs the whole fix and rolls it back, so it lists these too.
- **Found on production (2026-10-21):** 1,422 registration-fee accounts (10,026 collections) are numbered from NOP 2, 9,741 of them old-system collections: the old system and its receipts numbered DSP-290, D-190, D-270 (300) and D-180 that way too. Old-system collections are marked Remitted, which the script did not protect (only Approved).
- **Owner decision:** renumber only accounts started in this system; old-system history keeps the NOPs on its receipts and continues from its own numbering (only accounts opened from now start at NOP 1).
- **Done:** the script skips any account or collection with a LEG id and keeps the figures of Remitted and Approved collections; `--counts` prints the counts only. Applied on production: 7 collections renumbered on 5 DSP-290 accounts, 5 with new incentives (2 remitted kept theirs); a recount shows 0 left, 5 now from NOP 1, 1,441 old-system accounts left as they are.
- **In progress / To do:** none.

### Returned New Sales batch to another MAS (2026-10-21)

- **Owner:** when New Sales entries are rejected, the entry can change the MAS too, as long as that MAS is in Clearing.
- **Done:** `lib/batch-edit.ts`: `getReturnedBatch` returns `personEmployeeId` and, for New Sales, `masChoices` (active employees of the branch, `cleared` when in Clearing for New Sales on the Date Remitted). `saveReturnedBatch` takes `masEmployeeId`: an active employee of the branch, `clearingProblem` and `waitingBatchProblem` as when encoding, then each sale's `mas`, `accountable_employee_id` and `mas_employee_id`, and its account's `mas`, change (Record Corrections keeps before/after). The batch editor (`components/batch-editor.tsx`) has a MAS picker with uncleared MAS disabled. Test added; 216 pass; build passes.
- **In progress:** none.
- **To do:** none. The old MAS's clearing for that day stays open with nothing encoded; remove it in Clearing if it is not needed.

### Waiver and 60D from the last OR date again (2026-10-21)

- **Owner:** the Waiver should count as before, from the last OR date instead of Month of, so 60D and the Waiver are the same again.
- **Done:** `accountState` in `lib/account-rules.ts`: `suspendedAt` is the anchor plus two months (anchor: last OR date, or the DOI day of an advance's last covered month when later; the DOI before any collection), as before October 14; 60D/90D/120D/150D count whole months from the same anchor, so 60D and the Waiver start the same day. Paid October 10 for July: U until December 10, then 60D and suspended. The amount due (`unpaidMonths`, `paidThrough`) still counts missed months after Month of. Forfeiture unchanged. Tests updated (Waiver on the OR date, advance anchor, October-for-July); 216 pass; build passes. System guide's status table updated.
- **In progress:** none.
- **To do:** none. Statuses shown on screens are worked out live; the `account_status` stored on accounts (used by the executive dashboard's account-health counts) updates as each account is next saved.

### PH-00555176 Month of and NOP; program-move repair partly undone (2026-10-21)

- **Owner:** fix PH-00555176's Month of and NOP.
- **Found:** its D-190 receipts (M3-COLL rows 604 to 16910, OR January 16 to September 29, 2026) are for January to September 2026; the October 19 "Source Month of correction" had set that, and today's program-move repair (`fix-program-move-months-20261021.mts`, 05:05 UTC) moved them back a month. That repair took each collection's month from the first month/NOP change after its program move, so a deliberate correction made after the move was undone: 362 collections on 43 accounts (Source Month of / NOP corrections, Receipt consolidation, Member split, an owner-confirmed DPB-1000 transfer). The workbook's NOP skips 64 (63 March, 65 April), a typo; NOPs run 61-69 without a gap.
- **Done (owner chose to restore all 43):** `scripts/restore-program-move-repair-20261021.mts` put every collection the repair changed on those 43 accounts back to its value just before the repair (Audit Log), and numbered the one collection encoded since (COL-20261021062939-L3BJ, OR October 20) on from the restored history: October, NOP 66. Applied on production: 387 collections on 43 accounts; all pass the account rules; 27 stored statuses updated; no incentives changed. PH-00555176 is January-September 2026, NOP 61-69 (next October, NOP 70). Record Corrections: "Program move months restored".
- **Done:** the program-move repair script refuses to run (retired). The repair stays in effect on the other 29 accounts it changed (121 collections with no later correction).
- **Note:** reading the workbook rows for this member printed the member's name column once; the inspection script's output filter should leave out the PH/MEMBER column.
- **In progress / To do:** none.

### Clearing day-end review (2026-10-21)

- **Owner:** clear every clearing after the day (11:59 PM); when the Entry Clerk logs in the next day, ask whether to keep their Clearing list. Clerks often tick New Sales and Collections when only one is encoded; clearing such a line must keep what was encoded.
- **Done:** `getDayEndReview(employeeId)` lists the clerk's own lines of earlier days still on the list (not Approved, not cleared, not kept today). `settleDayEnd({ keep, clear })`: keep sets `closed_reason` "Kept on the list <date>" (asked again tomorrow); clear removes a line with nothing encoded, or narrows `covers` to the encoded kinds, makes an Open line Encoded and sets `closed_reason` "Cleared from the list …" (evidence of receipt kept for the encoded entries). `getClearingPage` leaves cleared lines out. API: `GET /api/clearing?review=1`, `PATCH { action: "day-end", keep, clear }`. Pop-up `components/clearing-day-end.tsx` in the app shell. No migration (uses `closed_reason`). Test added; 217 pass; build passes.
- **In progress:** none.
- **To do:** none. Lines are not cleared without the clerk's answer; "Ask me later" brings the pop-up back on the next page load.

### Clerk report: GCash cash-on-hand line reverted (2026-10-22)

- **Owner:** the Cash Out line Paid by GCash/bank (not cash), added earlier today (b76ce0b), made Cash on Hand smaller than the 4,911 it should be; revert it.
- **Done:** reverted; the cash summary is as before, and GCash or bank entries count as cash on hand again unless a matching cash forwarded to bank is recorded.
- **In progress:** none.
- **Likely cause:** the GCash collection was already balanced by a cash forwarded to bank of its original net (₱127.50, at ₱150); the correction to ₱210 left only the extra ₱51 in Cash on Hand, and the new line took out the whole ₱178.50 again.
- **To do:** confirm on BARRIENTOS, RUTCHELYN's October 21 report; if so, edit that deposit to ₱178.50 so Cash on Hand is 4,911.

### Expense accounts: the company's list (2026-10-22)

- **Owner:** change the expense accounts to the company's list (CBA (Cash Burial Assistance), Allowances, Services MAS incentives, Services Tie-up, Vehicle Maintenance, Transportation, Permit/License, Office Supplies, Gasoline, Professional Fee, ORC, Sales incentives, Collections incentives, Office Renovations, Office Rental, Monthly Bills, Interment, Funeral Supplies/stocks, Preservation, Pull-out, Forms/Receipt, Vehicle Registration, Meals, Medical Assistance, SSS, Philhealth, Embalming Supplies, Casket Procurement, Office Maintenance/renovations, Others); list recorded accounts that are not on it so the owner decides where each moves.
- **Done:** `lib/expense-options.ts` holds the new list (Expenses page, clerk report expense form, server validation). "Others" replaces "Other" and must be specified (`Others: <detail>`); CBA keeps the payee rule of Cash Burial Assistance. Tested.
- **Done:** Office Renovations and Meals added (30 accounts). Production had 21 old account names in use (posted and voided); the owner decided each: Allowance and Other: MOBILITY ALLOWANCE → Allowances; Cash Burial Assistance → CBA (Cash Burial Assistance); Electric Bill, Water Bill, Internet/Load → Monthly Bills; Monthly Office Rent → Office Rental; Other: Coolant 1L and Other: Monthly motorcycle payment → Vehicle Maintenance; Other: GASOLINE → Gasoline; Other: Travel expense for Ma'am Sheena → Transportation; Other: orc nagliba → ORC; Other: 10% Services Incentives and Other: MAS 10 % → Services MAS incentives; Meals/Snacks and the three 5KG/5KLS Starter up / Ultrapack → Meals; Bank Fee/Charge, Other: GCASH REMIT, Miscellaneous → Others: <same name>. `scripts/move-expense-accounts-20261022.mts` moves them (only the account name; refuses if any expense is left off the list; Audit Log and Record Corrections). The temporary listing script is deleted.
- **In progress:** none.
- **Done (2026-10-23):** applied on production by the owner: 55 expenses moved (the preview matched the listing account by account). The Supabase Realtime warnings it printed (no partition of realtime.messages) only skipped live-refresh signals; open Expenses pages need a reload.
- **To do:** none.

### MAM prints one row per member (2026-10-23)

- **Owner:** when printing MAM, each member should take one row as much as possible; it used too much paper.
- **Done:** printing only (the screen is unchanged): the member column prints one line (name, PH#, program, APP, DOI, monthly), and each month one line (status, collected, OR numbers, NOP, balance, Suspended when temporarily suspended; Needs review / — otherwise). The detailed cards, receipt boxes and summary grid are not printed; rows have tight padding and the member column 28% of the width. A long member line or many receipts in a month may still wrap to a second line. Build passes.
- **In progress:** none.
- **To do (owner):** print a branch from MAM and check the paper count; say if a field should be dropped or added.

### MAM status range filter (2026-10-23)

- **Owner:** apply a range in statuses, e.g. from NS to a later status.
- **Done:** the MAM Status filter has From and To (order NS, U, ADV, 60D, 90D, 120D, 150D, Forfeited); either can be left open (From only = that status onward, To only = up to it); picked in reverse it still works. An account shows when any month in the range has a status inside it, as the single status filter did. Reset clears both. Typecheck passes.
- **In progress / To do:** none.

### MAM sort by (2026-10-23)

- **Owner:** apply sort by on MAM.
- **Done:** a Sort by choice (As loaded, Member name, PH#, Program, DOI, Status, Balance, Collected in range) with Ascending/Descending. Status and Balance use the range's last month; Status follows NS, U, ADV, 60D, 90D, 120D, 150D, Forfeited. Accounts stay grouped by MAS and are sorted inside each group; ties go by member name. The screen, the printout and the CSV follow it. Reset clears it. Typecheck passes.
- **In progress / To do:** none.

### Fidelity opening balances from the old system (2026-10-23)

- **Owner:** import the old Fidelity Bond sheet (legacy-data/old-data/Sales + Fidelity Bond Record 2025.xlsx, tab "Fidelity Bond": 243 MAS, 2022-2023 / 2024 / 2025 / 2026, TOTAL 1,041,857.13, status, withdrawn) as opening balances. The 2026 column is old-system only. An Active MAS with a withdrawal: subtract it from the total. Inactive MAS with Withdrawn Y and no amount: list them for the owner.
- **Done:** `lib/fidelity.ts` types Opening Balance (old system) (in, approved) and Withdrawal (old system) (out); every transaction has a direction, used by the Fidelity pages. `scripts/import-fidelity-opening-20261023.mts` reads the tab (checks each row and the 1,041,857.13 total), matches names to employees (same surname and first name or initial, one employee only; `legacy-data/fidelity-name-map.json` settles the rest), holds back inactive MAS with any withdrawal or note (paid to loan / DCC / shortages), imports "Resigned not yet released" in full, skips employees that already have an opening balance, and writes Record Corrections. Row 44 (Borde, Gina) has "40.5.0" in 2026, which the sheet's TOTAL leaves out; TOTAL governs. Staging preview: 7 matched (staging has few employees), 63 held back, 173 not matched. Typecheck passes.
- **Production preview (owner, 2026-10-23):** 85 matched, 63 inactive held back, 95 not matched. **Owner: do not include the inactive.** The script now imports only MAS marked Active on the sheet (Inactive left out and counted). Seven Active spelling variants are settled in legacy-data/fidelity-name-map.json for the owner to confirm: Asilo, Maryjane → MD-2026-0019; Onio, Maeann → MD-2026-0067; Paredes → MD-2026-0038 (surname only); Sacay, Haneylyn → MD-2026-0028; Tortogo, Marykris → DNDO-2026-0038; Roldan, Emily → MD-2026-0071; Ramos, Roxanna → MD-2026-0073. Remedios, Milagros and Ricarte (Active) are not employees.
- **In progress:** owner previews again on production.
- **Owner:** Remedios, Milagros is not included; Ricarte is LEG-2026-0100 (both in the name map).
- **To do:** confirm the seven spelling matches in the production preview; apply.

### New Sales: "this member may already exist" pop-up (2026-10-23)

- **Owner:** members are duplicated because in New Sales the Entry Clerk types an existing member instead of selecting them. When the system detects the exact person while the clerk types, show a pop-up with the existing member's information so the clerk confirms whether it is the same person.
- **Done:** once a new member's surname and first name are typed (2+ letters each, 0.7 s after typing stops), `GET /api/members?sameName=1&surname=&firstName=` (`findSameNameMembers` in `lib/member-records.ts`) returns members with exactly that surname and first name (case, extra spaces and ñ/n do not matter). A typed middle initial or birthdate that differs rules a member out. For each remaining one a pop-up shows name, PH/Member number, birthdate, gender, contact, address and programs: **Yes, same person** links the sale to that member (as picking them from the list does); **No, a different person** keeps the new member and is not asked again for that member on that sale. The pop-up closes only with its buttons (not Escape or a click outside); `components/app-dialog.tsx` gained `cancelLabel` and `requireChoice`. Works in New Sales and MAS Sales. Test added; build passes.
- **In progress:** none.
- **To do:** members already duplicated are not merged by this; a merge of existing duplicates is a separate task (owner decides).

### Branch incentive tiers fall back to the base tiers (2026-10-23)

- **Owner:** "Configure exactly one MAS incentive tier for NOP 23" for Garciano, Marlyn (PH-38603255, D-320 / DP-0011, Nabunturan). Cause: D-320's MAS tiers, saved 2026-10-23 08:28 Manila, are base 13-60 and Nabunturan 1-6 only; a branch's own tiers replaced all base tiers of that role, so Nabunturan had no tier from month 7. Owner chose: a branch's own tiers override only the months they cover; other months fall back to the all-branches tiers.
- **Done:** `tiersForBranch` (lib/remittance.ts) returns the branch's own tiers plus the base tiers cut down to the months the branch does not cover (exactly one tier per month still). Every calculation uses it (New Sales, Collections, entry and batch edits, repricing). Programs page wording and system guide updated. Test with the D-320 case; all remittance tests pass.
- **Still open (owner):** D-320 has no MAS tier for months 1-12 outside Nabunturan and 7-12 in Nabunturan; add a base tier for 1-12 (or as intended) in Programs.
- **In progress / To do:** none besides the D-320 tiers above; the temporary lookup script is deleted.

### Reports update when data changes (2026-10-23)

- **Owner:** any change the system makes that a report reflects should update the report; sometimes data changed and the report did not.
- **Cause:** open pages reload when the database broadcasts a table change over Supabase Realtime (lib/use-live-refresh.ts, migration 0010). On production every save printed `WarnSendingBroadcastMessage: no partition of relation "messages" found for row`: Realtime stores broadcasts in daily partitions of realtime.messages, and without today's partition the broadcast is dropped (the trigger only warns), so open reports never heard of the change. Staging has its partitions (checked 2026-10-23). Also, the clerk and company reports did not watch every table they show.
- **Done:** `useLiveRefresh` also reloads when the tab is shown again or the window regains focus (if 15 s have passed), and every 60 s while visible when no broadcast has arrived for 2 minutes, so pages stay current even without Realtime. The clerk report also watches members, member_programs, programs, program_incentives, receipt_photos, employees, branches, remittance_methods; the company reports watch remittance_collections, bank_deposits, members, member_programs, programs, program_incentives, employees, branches, commissions. Build passes.
- **Done (2026-10-29):** owner ran `scripts/_tmp-check-realtime-partitions.mts` on production: realtime.messages has 0 partitions (none ever made), so every broadcast is dropped and other users see changes only on the fallback reload. Staging has them. The Realtime service makes the partitions once browsers connect to it, so the browser connection (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, built in at deploy) was checked next.
- **Done (2026-10-29), cause found:** both variables are set on Vercel, but the live site's Realtime connection goes to `nziflfmwqnaqcisssapy` (the **staging** project). Production pages listened to staging's change signals and never connected to production's Realtime, so production never made its partitions and its broadcasts were dropped. Only table names travel on the channel, so no records were exposed.
- **Done (2026-10-29), fixed:** owner set both Vercel Production variables to the production project and redeployed. The check script then showed 5 partitions on production (October 28 to November 1), today included, so broadcasts are stored and sent. Temporary script deleted. System guide (Live updates, item 2) now says both values must match the environment's project and how to check. The fallback reloads stay as a safety net.
- **Done (2026-10-29):** owner confirmed on the live site: a save by one user shows on another user's open page without a refresh.
- **In progress / To do:** none.

### Merge members registered twice (2026-10-23)

- **Owner:** fix the members already duplicated in the system (New Sales registered an existing person again); merge them.
- **Done:** `scripts/find-duplicate-members-20261023.mjs` (read-only) finds pairs with the same surname, first name and extension (case, spaces, ñ/n ignored) whose middle initials agree or one is blank, and whose birthdates are the same or one is blank; different birthdates are never paired. The member with more accounts and payments (then the older record) is kept. Pairs where both have an account in the same program are listed as "account clash" and left out (those accounts need merging first). It writes `legacy-data/duplicate-members-review-20261023.csv` (names, for the owner) and `config/member-merges-20261023.json` (PH numbers only). `scripts/merge-members.mjs` takes `--file=` and now fills a blank birthdate from the other member (two different birthdates are still refused). Staging: 13,035 members, 81 pairs (6 same birthdate, 65 one birthdate blank, 10 account clash); the dry run moved accounts, New Sales and payments and filled the kept member's blank details. Staging output deleted.
- **Production (2026-10-23):** 13,588 members, 119 pairs: 76 mergeable (one birthdate blank), 43 account clash. Of the 76, 58 are safe (same branch); 18 (different branches or both paying: #4, #5, #10, #39, #52, #74, #75, #78, #87, #88, #89, #99, #101, #102, #106, #110, #117, #118) the owner chose to leave as separate people. config/member-merges-20261023.json holds the 58. Owner: never merge Jr. or Sr.: #8, #40, #57 removed (55 left), and the finder now skips names with Jr., Sr., II, III or IV.
- **Dry run on production (owner, 2026-10-23):** all 55 merged cleanly (one account each, payments and New Sales moved, blank details filled). Owner chose the fuller name: merge-members.mjs gained `"useOtherName": "fuller"` (the other record's name when its middle name is longer or it has the ñ; in capitals), set on all 55.
- **Applied on production (owner, 2026-10-23):** 55 members merged (fuller names kept).
- **To do:** the 43 account-clash pairs (both have the same program; 25 with payments on both accounts) need the two accounts merged first: a separate review.

### Collections: several receipts for one account in a batch (2026-10-23)

- **Owner:** a member sometimes pays several months on separate OR receipts, but the batch could not be saved because of the NOP and Month of.
- **Cause:** each entry takes the account's next month and NOP from what is saved, so a second receipt for the same member and program in the same batch repeated the first one's; the server (which checks a batch's receipts in order) refused it ("NOP must start at …").
- **Done:** `chainSameAccount` (app/collections/page.tsx): every change to the entries passes through it; in batch order, each later receipt for the same member and program starts the month and NOP after the previous receipt ends, keeping its number of months (and amount); the first starts where the account stands, and removing or changing an earlier receipt moves the later ones. The months line says "continues after the earlier receipt for this account in this batch". The server is unchanged. Typecheck, lint and build pass.
- **Note:** the server also refuses an OR date earlier than the previous receipt's, so enter the receipts in OR date order.
- **In progress / To do:** none.

### Administrator decides an entry's incentive (2026-10-23)

- **Owner:** COL-20261023033733-XZFI and -N9UJ (Montevista, Collector CABILAN, LOTSMAN, OR 25618 N and 25619 N of October 20) had their incentives forfeited because the collector's clearing was recorded October 21 at 9:38 PM, after the 3:00 PM deadline. Nobody can correct a clearing time, even after a slip is returned (a resubmitted slip decides again from the same clearing), so the Administrator must be able to decide whether the incentive is kept or forfeited.
- **Done:** migration `0026_incentive_decision` adds incentive_decision, _reason, _by and _at to collections and sales. `lib/incentive-decision.ts` `decideIncentive` (Administrators only, `PATCH /api/remittances/incentive`, a reason of 5+ characters): **Keep** or **Forfeit** overrides the 3:00 PM rule, **Follow the rule** clears the decision. On a slip still pending the entry's company share, the slip line and its expected amount change at once (the actual cash stays, so the difference shows what to return or collect); an entry not on a slip keeps the decision for its next slip; approved entries and entries marked No incentive are refused. `forfeitsIncentive` (lib/remittance-workflow.ts) follows the decision, so a returned and resubmitted slip keeps it. Remittances → View entries shows the decision (who, when, why) and, for Administrators, Keep / Forfeit / Follow the rule. Record Corrections keeps each decision. `scripts/check-database.mjs` checks 0026. Staging migrated. Test added; all 221 tests and the build pass.
- **Keeping the difference at 0 (owner, same day):** slips are made with the actual equal to the expected, so a decision on a pending slip now asks the Administrator whether to change the slip's actual cash by the same amount (moveActual): Yes keeps the difference as it was (a ₱0 slip stays ₱0; after Keep the reminder says to give the incentive back if the collector handed over the full amount); No keeps the actual, and the difference shows what to return or collect. A Discrepancy slip whose difference becomes ₱0 goes back to Pending Approval. Without a decision the other ways remain: return and resubmit (a new slip is made with actual = expected, and the decision stays), or approve with a reason. Test extended; build passes.
- **To do (owner):** BEFORE pushing, run `npm run prod -- npm run db:migrate`, then `npm run prod -- node scripts/check-database.mjs` (OK). Then decide the two Montevista entries on slip REM-20261023055232-9T2P (choose whether the actual moves with it).

### Clearing again the same day asks "new handover?" (2026-10-23)

- **Owner:** incentives were forfeited although the MAS was cleared before 3 PM (COL-20261023071913-Y3R0, COL-20261023072448-JGAG; Cabadbaran, RACHO, KRISTINE, OR dates October 22).
- **Cause:** she was cleared at 2:41 PM (on time; Both). The first batch was encoded under it, which marks the clearing Encoded; the clerk then cleared her again at 3:18 and 3:23 PM for two more batches, and each slip took its own (late) clearing as the time received. An Encoded clearing still covers more batches the same day, so no new clearing was needed. Both entries were already set to Keep by an Administrator.
- **Done:** `addClearing` (lib/clearing.ts) refuses a new clearing when the person already has an Encoded clearing that day for the same kind, with `AlreadyClearedError` (code ALREADY_CLEARED, the earlier time and why); the Clearing page asks "Already cleared today" → **New handover: clear again** (newHandover) or Cancel ("Encode the remaining batches under the earlier clearing"). Test added; all tests and the build pass. The temporary diagnostic script is deleted.
- **In progress / To do:** none.

### Deposits: one reference once, dated within the report (2026-10-23)

- **Owner:** CABALLERO, JENNY (Mintal) recorded GCash reference 8046291340931 (₱880, for three GCash collections encoded October 20) twice on October 20, two minutes apart: DEP-20261020022515-LOTM dated October 19 and DEP-20261020022740-JSDW dated October 20 ("ACTUAL DEPO DATE 10-19"), so ₱880 left Cash on Hand in both reports. Handle it so it does not happen again. Owner: a deposit belongs to the report it is entered on; "if they want to really go to that date, they just change the period of their report".
- **Done:** `duplicateReferenceProblem` (lib/clerk-cash.ts): a run of 6+ digits in the remarks already on another deposit that is not voided refuses adding or editing, naming that deposit (amount, date, who) to edit or void instead. `depositDayProblem` (lib/deposit-day.ts, used by add-deposit and edit-deposit in app/api/clerk-report/route.ts): the deposit date must be within the report it is entered on (the report sends reportKind and reportDate); on a daily report the Date field shows the report's day and cannot be changed, on a weekly report only days of that week can be picked. The report still lists deposits by their date. (A "day recorded" rule was tried first and reverted on the owner's instruction.) Tests added; all 224 tests and the build pass.
- **To do (Jenny or an administrator):** void DEP-20261020022515-LOTM on the October 19 report ("Recorded twice; kept on October 20 with its GCash collections").
