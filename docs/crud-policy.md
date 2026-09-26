# CRUD and record lifecycle

CRUD is implemented according to the type of record and its audit requirements.

| Module | Create | Read | Update | Delete / lifecycle rule |
| --- | --- | --- | --- | --- |
| Branches | Branch form | Branch directory | Full details and status | Delete only when no employee assignment or member enrollment references it; otherwise mark inactive |
| Programs | Program and incentive form | Program directory | Details, status, base pay, and incentive tiers | Delete only when no member enrollment references it; otherwise mark inactive |
| Members | New Sales registration | Member directory and MAM | Contact number and master status | Delete only without a program enrollment; enrolled members retain their history |
| Employees | Employee registration | Employee directory | Details, roles, branches, and status | Delete only when no login account references the employee |
| User Accounts | Administrator account form | Account directory | Username, status, roles, and optional password reset | Administrators cannot delete their current signed-in account |
| Expenses and Cash Transactions | Finance forms | Finance ledger | Void lifecycle | Posted financial records are voided with a reason |
| Collections and Remittances | Encoding and turnover | History, MAM, and remittance workspace | Status, approval, or rejection | Financial history is retained for reconciliation |
| Attendance and Leave | Employee and review workflows | Attendance and leave views | Clock, review, approval, or rejection | Personnel history is retained |

Master-data mutations require the existing manage-users permission. APIs enforce authorization and relationship checks even when action buttons are hidden. Deleted sheet records do not cause IDs to be renumbered or reused.

Transaction records use lifecycle operations because hard deletion would break financial, personnel, encoder, or approval history.
