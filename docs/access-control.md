# Role-based access control

Dayong uses four access layers:

1. **Role** identifies the user's workspace.
2. **Navigation access** controls which links appear.
3. **Page access** prevents direct navigation to a page outside that workspace.
4. **Action permissions** protect sensitive server operations.

Role names are read from the live `Roles` and `User Roles` sheets during login and stored in the signed session token alongside stable role IDs. Navigation never depends on a hard-coded role ID.

## Current page matrix

| Role | Current pages |
| --- | --- |
| Administrator | All implemented pages |
| CEO / President | Dashboard, Members, MAM, Remittances, Programs, Branches, Cash Ledger, Settings |
| HR Officer | Dashboard, Employees, Branches, Attendance, Attendance Review, Leave Requests, Leave Approvals, Settings |
| Finance | Dashboard, Members, Collections, Remittances, MAM, Programs, Expenses, Cash Ledger, Settings |
| Entry Clerk | Dashboard, New Sales, Members, Collections, Attendance, Leave Requests, Settings |
| IT Clerk | Dashboard, Employees, User Accounts, Branches, Settings |
| MAS | Dashboard, Members, Collections, Remittances, MAM, Attendance, Leave Requests, Settings |

`Finance` is supported by the code but is not currently present in the live Roles sheet. Add and assign it through an authorized role-management process before expecting a Finance-only workspace.

Existing action permissions remain authoritative. `manage_users` protects account management and finance voids; `manage_attendance` protects attendance and leave review; remittance approval requires the existing management permission and prevents self-approval.

The Administrator/Admin role always receives master-data management actions even if the legacy `manage_users` cell is blank or false. This prevents the navigation role and action controls from contradicting each other. Other roles still require their explicit action permission.

## Remaining scope work

Role access answers which modules a user may open. Record scope still needs a dedicated model for `ALL`, `BRANCH`, `ASSIGNED`, and `OWN`. Until that is implemented, MAS pages are not filtered to assigned Member Programs and Entry Clerk pages are not filtered to their own entries. Do not describe those scopes as enforced.

Future permission work should replace broad boolean flags with stable permission keys such as `collections.create`, `remittances.approve`, `finance.void`, and `users.assign_role`, plus a separate scope assignment.
