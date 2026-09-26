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
- When the Member Program's account status is NS, the NOP range is editable. The range must still match the number of covered months. The New Sales transaction itself remains excluded from NOP.
- When the account status is not NS, Collections shows **NOP From** and **NOP To** as automatically calculated, non-editable fields. The server must enforce the calculated values rather than trusting a submitted range.
- Each covered month maps to its corresponding NOP. For example, January through March with NOP From 1 and NOP To 3 means January = 1, February = 2, March = 3. These month names and NOP values are illustrative, not fixed starting values.
- Advance payment is allowed only when the payment brings the account to U or ADV. An account with arrears may pay enough to catch up and cover future months in the same payment; it may not skip unpaid due months to pay future months while remaining overdue.
- Account status (NS/U/ADV/delinquency) is distinct from a transaction's posting status and from the existing Active/Inactive-style UI field. Do not let a manually selected status bypass payment or NOP validation.

Collections now uses each entry's calculated account status for NOP editability. The backend validates NOP against stored and pending batch payments, whole installments, continuous coverage, waivers, Collector information, and forfeiture. Amount Collected is automatically calculated and read-only.

### Collector tracking, suspension, and forfeiture

- **Original MAS / Officer's Name** is required when a collection is performed by a **Collector**, to track the account's original MAS/officer. Its purpose is not specifically reactivation. The Collector, the original MAS/officer, and the signed-in encoder are separate identities.
- Collections now has a separate **Collected By Role** field (MAS or Collector). Original MAS / Officer Name is required for Collector entries in both frontend and backend; reactivation alone does not require it. The role is not inferred from the signed-in encoder.
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

Each signed-in user can change their own username and password in Settings after verifying the current password. Password changes require at least 12 characters and reject a small local list of commonly used credentials. Role assignments and account status remain administrator-controlled, following least privilege; password recovery by email is not available until a verified email-delivery and reset-token service is configured.

`node scripts/migrate-employees.mjs --apply` creates the sheet and imports missing staff IDs, names, and branches from Users. Five existing IDs were imported. Employment status, operational roles, dates, and historical encoder identity are left blank when unknown; review these fields in Sheets. Existing operational choices retain legacy Users fallback for unreviewed staff. Sequential DPE allocation, like existing user-ID allocation, is not protected by a distributed lock; concurrent registrations across server instances need a transactional allocator before scaling.

Members supports ascending/descending sorting by name, PH number, city, province, and member status before pagination. Employees supports search, branch/role/status filters, sorting, and pagination.

## Migration-ready Google Sheets

The application-managed tabs now have a canonical database schema in `config/sheet-database-schema.json` and a read-only audit available through `npm run sheets:audit`. The audit checks stable primary keys, duplicate IDs, merged cells, blank rows inside tables, canonical lowercase headers, and known column types. The original 15 application-managed sheets were migrated to lowercase `snake_case` headers, and the two Finance sheets were created with canonical headers. Runtime header checks accept canonicalized names while continuing to guard numeric column positions.

## Collections and physical Remittance

Collections and Remittances are now separate transactions. Saving Collections immediately records member payments as `Outstanding`; it no longer creates a Remittances row. A physical turnover is created from selected outstanding Collection IDs, stores expected and actual cash separately, and uses the `Remittance Collections` mapping sheet. Submitted turnovers are `Pending Approval` or `Discrepancy`. Only approval changes linked Collections to `Remitted` and clears cash accountability; rejection requires a reason and returns the Collections to `Outstanding`. The submitter cannot decide the same Remittance. Historical Collections and automatic Remittances from the previous design are marked for review rather than assumed to represent verified turnover. See `docs/collections-remittance-workflow.md`.

Collections member search is scoped by the selected Branch and MAS through active Member Program enrollments. Search results include only the programs matching that same Branch/MAS relationship. A member with one eligible program has it selected automatically; a member with several eligible programs requires the encoder to choose. Changing Branch or MAS clears previously selected members and programs. Collection history is ordered from the latest NOP to the oldest.

New Sales uses Application Number as its required transaction reference. It does not ask for or require an OR Number; the legacy Sales `or_number` column remains blank for new rows so existing column positions and historical data remain intact.

## Rules still requiring business decisions

Further business decisions remain for complete transfer/history workflows, special incentive cases, detailed role permissions, attendance policy changes, dashboard KPIs, and future report layouts. The current defaults and remittance formula are described in the implementation document. Use the confirmed whole-installment payment rule and MAM meanings above rather than treating them as unresolved. Existing code describes current behavior but does not establish an unconfirmed business policy.

## Finance implementation

Finance now uses persistent `Expenses` and `Cash Transactions` sheets rather than browser-only page state. Expenses record a stable ID, date, category, description, amount, payee, payment source, branch, payment method, references, receipt number, status, remarks, timestamps, verified encoder identity, and void history. Posted expenses automatically appear as cash-ledger outflows.

The consolidated cash ledger combines approved physical Remittances as inflows, posted Expenses as outflows, and separately encoded manual cash adjustments. Manual entries include direction, category, cash account, branch, references, status, encoder identity, and void history. Users should not duplicate approved Remittances or Expenses as manual entries. Financial entries are voided with a reason rather than deleted; void permission currently follows the existing manage-users permission until a dedicated finance permission is defined.

Migration: `npm run sheets:finance -- --apply`. The live workbook was migrated on 2026-09-26.

## Branding, login, and interface updates

The official `icons/dayong_logo.png` artwork is used in the sidebar, login screen, and browser-tab icon. The login page has a dedicated full-screen shell and never renders the application navigation. It presents the supplied Vision, Mission, formatted workplace Prayer, and official Facebook link while keeping the working username/password authentication flow. Google login and password reset were not added because no corresponding authentication backend exists.

Attendance now uses the violet/lime visual system with Philippine Standard Time, live session duration, progress and attendance metrics, and actual clock-in/out activity. MAM uses the same visual language while preserving month-range controls, status synchronization, filtering, horizontal comparison, print/CSV actions, grouped MAS totals, projections, and account details.

Production authentication now validates required server environment variables lazily, normalizes quoted or escaped Google private keys, and returns actionable configuration errors instead of an HTML failure. Vercel must define `AUTH_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `GOOGLE_SHEET_ID` in the Production environment and redeploy after changes.

## Role-based navigation

Login sessions now contain stable role IDs and role names. The sidebar is generated from role access, and the proxy rejects direct navigation to pages outside the current role workspace. The live roles are Administrator, HR Officer, CEO, President, Entry Clerk, IT Clerk, and MAS; the future Finance role is supported but not present in the live sheet. Existing server action permissions remain in force. See [role-based access](access-control.md) for the matrix and explicit data-scope limitations.

The specification's statements about previously completed features or builds must be checked when relevant; they are not evidence that every described operation is currently supported.
