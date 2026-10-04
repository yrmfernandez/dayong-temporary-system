# Dayong System project context

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

Fidelity Savings (rule changed 2026-10-02) is the employee's own money handed over with a batch: it is added to the total remittance, never deducted from incentives, and has no limit. The first ₱10,000 of the balance is locked until the employee leaves; anything above it can be withdrawn any time. See `docs/fidelity.md`.

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

- **Control total:** before saving a New Sales or Collections batch, the clerk types the total from the MAS's turnover sheet. The batch saves only when the entries add up to it exactly (`lib/entry-controls.ts`, checked by the form and the server).
- **Late entries:** an OR or application date older than yesterday needs a reason, kept in Collections AN / Sales AS `backdate_reason` and listed in Exceptions for 30 days.
- **Cash count:** cash remittances, and cash received in full on Collections, are counted by bill and coin (₱1000 to ₱1). The amount received is the counted total, and the count is kept in Remittances AB `cash_count` (e.g. `1000x3, 500x1`). The server checks that a submitted count adds up to the amount.
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
- **Receipt photos** (`lib/receipt-photos.ts`, sheet `Receipt Photos`): the browser shrinks each photo (grayscale, at most 1280 px, WebP or JPEG) to at most 80 KB; it is stored as base64 split across up to four cells (a cell holds 50,000 characters). One photo may cover several entries. Clerks attach them in My Entries (`/my-entries`) to entries they encoded; administrators to any. An administrator cannot approve a submitted remittance until every item has a photo. Cash received in full (approved at once by whoever received it, on Collections or Remittances) does not wait for photos; the photo is optional on the Collections form and clerks attach it later in Today's Entries or My Entries (2026-10-04). Photo data columns are masked in the Audit Log.

## Employee IDs (2026-10-04)

- The 95 MAS named on old-data accounts who were not employees were registered with `scripts/register-legacy-mas.mjs`: temporary IDs `LEG-2026-NNNN`, the exact name on their accounts, role MAS, status active, every branch where they have accounts (primary = most accounts), no sign-in account. "Others", "DTO" and "Cuizon-DTO" were skipped.
- Administrators can change an Employee ID in Employees → Edit (`lib/employee-id-change.ts`). Every column whose header ends in employee_id / Employee ID, in every tab except the Audit Log and the Legacy Pending tabs, is rewritten from the old ID to the new one (Users too, so the person signs in with the new ID), plus Report Notes keys. Each edit is in the Audit Log and the change is summarized in Record Corrections. Record IDs that only contain the old ID (EBA-…, ATT-…) are left alone.

## Legacy repair rules (2026-10-04)

`scripts/migrate-legacy-members.mjs --pending --repair` fixes failing old-data accounts by the company's rules: an unreadable AMOUNT COLLECTED becomes the program's monthly rate x the months covered (or the usual monthly amount paid for the program when it has no rate); an unreadable OR DATE becomes the DATE REMITTED; the same OR number twice on one account keeps one; missing NOPs and receipts claiming the same NOP or month are fixed by renumbering every payment consecutively in OR-date order (from NOP 2 after a New Sale, else from the account's first NOP), each covering the months its amount pays at the program rate. An account with no usable DOI takes its first OR date as the DOI. Every payment must be an exact whole number of monthly payments at the program rate; an account with any other amount is not imported and is listed for review. Only accounts that fail as recorded are repaired. Every change is listed in the `Legacy Repairs` tab (row reference, before, after), and with `--apply` the imported rows are removed from the Legacy Pending tabs. On 2026-10-04 this imported 598 accounts and 4,151 collections.

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

Administrators, HR, the CEO and President (and anyone with manage-attendance) can correct a clocked-in day on the Attendance Tracking daily board: **Adjust late**, and **Set clock-out / Fix clock-out** for an employee who forgot to clock out or clocked out at the wrong time. Worked hours, overtime and undertime are recalculated exactly as at clock-out, and the change, who made it and the reason are appended to the attendance notes. Past days list anyone who did not clock out.

## Audits (daily, weekly, monthly, yearly)

The Audits page (`/audit`, formerly Daily Audit) audits each Entry Clerk's report by day, week (Monday to Sunday), month or year, with the same workflow: HR/Finance prepare, only an Administrator approves (which locks the figures) or reopens with a reason. Weekly, monthly and yearly audits use the report totals for the whole period plus how the clerk's daily audits in that period stand. They are stored in Weekly Audits, Monthly Audits and Yearly Audits, laid out like Daily Audits with report_date = the period's first day (`npm run sheets:period-audits -- --apply`, applied 2026-10-02). The Daily summary tab still summarizes approved daily audits.
