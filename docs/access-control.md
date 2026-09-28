# Role-based access control

Dayong uses four access layers:

1. **Role** identifies the user's workspace.
2. **Navigation access** controls which links appear.
3. **Page access** prevents direct navigation to a page outside that workspace.
4. **Action permissions** protect sensitive server operations.

Role names are read from the live `Roles` and `User Roles` sheets during login and stored in the signed session token alongside stable role IDs. Navigation never depends on a hard-coded role ID.

## Sidebar role workspaces

Workspaces are defined once in `lib/navigation.ts`. Each role's sidebar lists that role's work first, then oversight, reference lookups, and personal self-service (My HR). Settings and Sign out sit in the sidebar footer for every role. A link only appears when `canAccessPath` also allows it for the session, so the sidebar never shows a page the server would redirect away from.

| Role | Sidebar sections |
| --- | --- |
| Administrator | Overview · Operations (New Sales, Collections, Remittances, MAM) · Finance (Cash Transactions, Expenses, Vendor Payables, Commissions, Fidelity) · Reports (Reports, User Report Review) · People · Master Data · Administration (User Accounts, Roles, Audit Log) · My HR |
| CEO / President | Overview (Dashboard, Reports, MAM) · Cash Oversight (Remittances, Cash Transactions, Fidelity) · Directory (Members, Programs, Branches) · My HR |
| Finance | Overview · Cash (Remittances, Collections, Cash Transactions) · Payables (Expenses, Vendor Payables, Commissions) · Monitoring (MAM, Fidelity, Reports, Audit Log) · Directory (Members, Programs) · My HR (Attendance, Attendance Tracking, Leave Requests) |
| Entry Clerk | Overview · Encoding (New Sales, Collections, Remittances) · Reports · Lookup (Members, Programs, Branches) · My HR |
| HR Officer | Overview · People (Employees, Attendance Review, Attendance Tracking, Leave Approvals) · Directory (Branches) · My HR |
| IT Clerk | Overview · Access (User Accounts, Employees, Roles) · Configuration (Branches, Programs, Audit Log) · My HR. Roles and Audit Log require `manage_users`, matching their APIs. |
| MAS | Overview · My Portfolio (My Members, MAM, My Fidelity) · Reference (Programs, Branches, Master Data) · My HR |

Reports shows its Daily, Weekly, Monthly, and Yearly pages as nested links.

Users with several roles choose an active role at the top of the sidebar. This changes the visible workspace and returns the user to Dashboard when the current page is outside the newly selected workspace. It does not remove permissions from the signed session: server authorization still evaluates every assigned role. The selected role and minimized/maximized state are stored in the browser; the Pill/Line active-link style and compact tables are set in Settings → Workspace preferences.

Every signed-in employee also receives a MAS workspace option in the role switcher because every employee may manage members. This is a navigation workspace and does not add a duplicate `User Roles` database row. Administrator, HR, Finance, and users with attendance-report permission can open Attendance Tracking to select an employee and review a date range, daily records, worked and overtime hours, lateness, undertime, leave, absence, and AWOL information.

Administrators also have a separate User Report Review page for filtering operational reports by encoder and period.

Existing action permissions remain authoritative. `manage_users` protects account management and finance voids; `manage_attendance` protects attendance and leave review; remittance approval requires the existing management permission and prevents self-approval.

The Administrator/Admin role always receives master-data management actions even if the legacy `manage_users` cell is blank or false. This prevents the navigation role and action controls from contradicting each other. Other roles still require their explicit action permission.

## Remaining scope work

Role access answers which modules a user may open. Record scope still needs a dedicated model for `ALL`, `BRANCH`, `ASSIGNED`, and `OWN`. Until that is implemented, MAS pages are not filtered to assigned Member Programs and Entry Clerk pages are not filtered to their own entries. Do not describe those scopes as enforced.

Programs and Branches are reference directories available to every signed-in role. Their API returns `canManage: false` unless the session has the manage-users permission or an Administrator role, so read access does not grant create, edit, or delete access. Administrators also receive Role Management and Entry History workspaces.

Future permission work should replace broad boolean flags with stable permission keys such as `collections.create`, `remittances.approve`, `finance.void`, and `users.assign_role`, plus a separate scope assignment.
