# Role-based access control

Dayong uses four access layers:

1. **Role** identifies the user's workspace.
2. **Navigation access** controls which links appear.
3. **Page access** prevents direct navigation to a page outside that workspace.
4. **Action permissions** protect sensitive server operations.

Role names are read from the live `Roles` and `User Roles` sheets during login and stored in the signed session token alongside stable role IDs. Navigation never depends on a hard-coded role ID.

## Sidebar role workspaces

Every role starts with the shared employee workspace: Dashboard, My Members, My Fidelity, MAM, Attendance, Leave Requests, Master Data, Programs, Branches, and Settings. The selected role adds these specialist pages:

| Role | Additional sidebar pages |
| --- | --- |
| Administrator | All implemented pages, including Roles, Entry History, and User Report Review |
| CEO / President | Remittances, Cash Transactions, and all Reports |
| HR Officer | Employees, Attendance Review, Attendance Tracking, and Leave Approvals |
| Finance | Collections, Remittances, Expenses, Cash Transactions, Attendance Tracking, and all Reports |
| Entry Clerk | New Sales, Collections, Remittances, and all Reports |
| IT Clerk | Employees, User Accounts, Roles, and Entry History |
| MAS | Shared employee workspace only |

Users with several roles choose an active role at the top of the sidebar. This changes the visible workspace and returns the user to Dashboard when the current page is outside the newly selected workspace. It does not remove permissions from the signed session: server authorization still evaluates every assigned role. The selected role, minimized/maximized state, and Pill/Line active-link style are stored in the browser.

Every signed-in employee also receives a MAS workspace option in the role switcher because every employee may manage members. This is a navigation workspace and does not add a duplicate `User Roles` database row. Administrator, HR, Finance, and users with attendance-report permission can open Attendance Tracking to select an employee and review a date range, daily records, worked and overtime hours, lateness, undertime, leave, absence, and AWOL information.

Administrators also have a separate User Report Review page for filtering operational reports by encoder and period.

Existing action permissions remain authoritative. `manage_users` protects account management and finance voids; `manage_attendance` protects attendance and leave review; remittance approval requires the existing management permission and prevents self-approval.

The Administrator/Admin role always receives master-data management actions even if the legacy `manage_users` cell is blank or false. This prevents the navigation role and action controls from contradicting each other. Other roles still require their explicit action permission.

## Remaining scope work

Role access answers which modules a user may open. Record scope still needs a dedicated model for `ALL`, `BRANCH`, `ASSIGNED`, and `OWN`. Until that is implemented, MAS pages are not filtered to assigned Member Programs and Entry Clerk pages are not filtered to their own entries. Do not describe those scopes as enforced.

Programs and Branches are reference directories available to every signed-in role. Their API returns `canManage: false` unless the session has the manage-users permission or an Administrator role, so read access does not grant create, edit, or delete access. Administrators also receive Role Management and Entry History workspaces.

Future permission work should replace broad boolean flags with stable permission keys such as `collections.create`, `remittances.approve`, `finance.void`, and `users.assign_role`, plus a separate scope assignment.
