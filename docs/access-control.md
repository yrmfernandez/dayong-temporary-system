# Role-based access control

Dayong uses four access layers:

1. **Role** identifies the user's workspace.
2. **Navigation access** controls which links appear.
3. **Page access** prevents direct navigation to a page outside that workspace.
4. **Action permissions** protect sensitive server operations.

Role names are read from the live `Roles` and `User Roles` sheets during login and stored in the signed session token alongside stable role IDs. Navigation never depends on a hard-coded role ID.

## Page access per role

Administrators choose which pages each role can open in **Roles → Page access**. The selection is stored as comma-separated routes in `Roles` column L (`page_access`) and copied into the signed session at sign-in, so changes apply the next time affected users sign in.

- A blank `page_access` means the role still uses its built-in defaults from `lib/access-control.ts`; the editor pre-fills those defaults.
- Dashboard and Settings are always allowed. Administrator always has every page and cannot be restricted.
- A user receives the combined pages of all their roles. Action permissions (`manage_users`, `manage_attendance`, `view_attendance_reports`) still add the pages their APIs need.
- In the sidebar, a configured role shows only its granted pages. A granted page outside the role's usual workspace joins the section where it belongs: the role's section that already holds related pages, else the section of the same name, else a new section named as in the Administrator workspace (placed before My HR).

## Job permissions

`manage_users` is a broad flag: it also approves remittances and voids finance records. IT and HR therefore receive only the part of it their work needs (`lib/access-control.ts`):

| Permission | Who | Protects |
| --- | --- | --- |
| Manage accounts | `manage_users`, Administrator, IT Clerk | User Accounts, Roles, Audit Log (read), Sheets connection test |
| Manage employees | `manage_users`, Administrator, IT Clerk, HR Officer | Registering, editing and removing employees |
| Manage configuration | `manage_users`, Administrator, IT Clerk | Branches, Programs, Program Incentives |

Only an administrator (or a `manage_users` holder) may assign the Administrator role or any role with `manage_users`, turn that flag on, or change, reset or delete an administrator's account (`lib/privilege-guard.ts`). An employee registered by HR or IT with an administrator-level role is saved without an automatic account.

## API access

Every `/api` route except sign-in, sign-out and session requires a valid session in `proxy.ts` before its handler runs. Handlers then check the same page access as the sidebar through `userWithPageAccess` (for example, Expenses needs `/expenses`), so a page and its data can never disagree.

## Dashboards

The dashboard follows the workspace chosen in the role switcher (stored in the `dayong_role` cookie) and is only shown when the user really holds that role. Executive: sales analytics. Finance: cash and accountability. HR: people today (attendance, lateness, leave). IT: system health. Entry Clerk: today's encoding. MAS: portfolio and accounts to follow up. Collector: own collections. Administrator: system overview.

## Sign-in

Employees sign in with their **Employee ID** and password. Usernames were removed from the Users sheet and the application (`npm run sheets:employee-login`).

## Sidebar role workspaces

Workspaces are defined once in `lib/navigation.ts`. Each role's sidebar lists that role's work first, then oversight, reference lookups, and personal self-service (My HR). Settings and Sign out sit in the sidebar footer for every role. A link only appears when `canAccessPath` also allows it for the session, so the sidebar never shows a page the server would redirect away from.

| Role | Sidebar sections |
| --- | --- |
| Administrator | Overview · Operations (New Sales, Collections, Remittances, MAM) · Finance (Cash Transactions, Expenses, Vendor Payables, Commissions, Fidelity) · Reports (Reports, Statement of Account, Daily Audit, User Report Review) · People · Master Data · Administration (User Accounts, Roles, Audit Log) · My HR |
| CEO / President | Overview (Dashboard) · Reports (User Report Review, MAM) · Directory (Members) · People (Attendance Tracking, including the printable daily board and late-time adjustment) · My HR (My Attendance). The dashboard is the executive analytics view (`lib/executive-analytics.ts`). Executive roles do not receive the shared employee pages, and a user whose only roles are CEO / President is not offered the MAS workspace. |
| Finance | Overview · Cash (Remittances, Cash Transactions) · Payables (Payroll, Commissions, Expenses, Vendor Payables) · Monitoring (MAM, Fidelity, Daily Audit, Attendance Tracking, Audit Log) · Directory (Members, Programs) · My HR |
| Entry Clerk | Overview · Encoding (New Sales, Collections, Remittances) · Reports · Lookup (Members, Programs, Branches) · My HR |
| HR Officer | Overview · People (Employees, Attendance Review, Attendance Tracking, Leave Approvals) · Directory (Branches) · My HR |
| IT Clerk | System (System Health dashboard) · Access Control (User Accounts, Roles, Employees) · Configuration (Branches, Programs, Master Data) · Monitoring (Audit Log) · My HR. IT does not need the `manage_users` flag; see Job permissions. |
| MAS | Overview · My Portfolio (My Members, MAM, My Fidelity) · Reference (Programs, Branches, Master Data) · My HR |

Reports shows its Daily, Weekly, Monthly, and Yearly pages as nested links.

New Sales, Collections, and Reports (daily to yearly) are the Entry Clerk's daily operations: no other role receives them by default, and their APIs check the same page access. Administrator keeps every page. An administrator can still grant them to another role in Roles → Page access. The Members page shows Add Member (which opens New Sales) only to users who can open New Sales.

Users with several roles choose an active role at the top of the sidebar. This changes the visible workspace and returns the user to Dashboard when the current page is outside the newly selected workspace. It does not remove permissions from the signed session: server authorization still evaluates every assigned role. The selected role and minimized/maximized state are stored in the browser; the Pill/Line active-link style and compact tables are set in Settings → Workspace preferences.

Every signed-in employee also receives a MAS workspace option in the role switcher because every employee may manage members. This is a navigation workspace and does not add a duplicate `User Roles` database row. Administrator, HR, Finance, and users with attendance-report permission can open Attendance Tracking to select an employee and review a date range, daily records, worked and overtime hours, lateness, undertime, leave, absence, and AWOL information.

Administrators also have a separate User Report Review page for filtering operational reports by encoder and period.

Existing action permissions remain authoritative. `manage_users` protects account management and finance voids; `manage_attendance` protects attendance and leave review; remittance approval requires the existing management permission and prevents self-approval.

The Administrator/Admin role always receives master-data management actions even if the legacy `manage_users` cell is blank or false. This prevents the navigation role and action controls from contradicting each other. Other roles still require their explicit action permission.

## Remaining scope work

Role access answers which modules a user may open. Record scope still needs a dedicated model for `ALL`, `BRANCH`, `ASSIGNED`, and `OWN`. Until that is implemented, MAS pages are not filtered to assigned Member Programs and Entry Clerk pages are not filtered to their own entries. Do not describe those scopes as enforced.

Programs and Branches are reference directories available to every signed-in role. Their API returns `canManage: false` unless the session has the manage-users permission or an Administrator role, so read access does not grant create, edit, or delete access. Administrators also receive Role Management and Entry History workspaces.

Future permission work should replace broad boolean flags with stable permission keys such as `collections.create`, `remittances.approve`, `finance.void`, and `users.assign_role`, plus a separate scope assignment.

## Statement of Account

`/soa` prints a member's Statement of Account for one program enrollment: member and plan details, the New Sale payment, every posted Collection with its months and NOP, and today's status, amount due, next due month, and remaining pay-the-balance. Figures come from the same rules as MAM (`lib/account-rules.ts`). Administrators, the CEO, and the President have it by default (under Reports); grant it to another role in Roles → Page access. Filters for search, branch, MAS, program, and today's status narrow the account picker and list the matching accounts.
