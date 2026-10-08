# CRUD and record lifecycle

CRUD is implemented according to the type of record and its audit requirements.

| Module | Create | Read | Update | Delete / lifecycle rule |
| --- | --- | --- | --- | --- |
| Branches | Branch form | Branch directory | Full details and status | Delete only when no employee assignment or member enrollment references it; otherwise mark inactive |
| Programs | Program and incentive form | Program directory | Details, status, base pay, and incentive tiers | Delete only when no member enrollment references it; otherwise mark inactive |
| Members | New Sales registration | Member directory and MAM | Every member detail for Administrators / manage-users (PH number, name parts, birthdate, birthplace, sex, age, civil status, contact, address, claimant, status; October 8, 2026); copies on New Sales, accounts and collections follow | Delete only without a program enrollment; enrolled members retain their history. Administrators: permanent delete with every account, sale and collection |
| Employees | Employee registration | Employee directory | Details, roles, branches, and status | Delete only when no login account references the employee |
| User Accounts | Administrator account form | Account directory | Status, roles, and optional password reset (the Employee ID is the sign-in ID and is not editable) | Administrators cannot delete their current signed-in account |
| Expenses and Cash Transactions | Finance forms | Finance ledger | Void lifecycle | Posted financial records are voided with a reason |
| Collections and Remittances | Encoding and turnover | History, MAM, and remittance workspace | Status, approval, or rejection | Financial history is retained for reconciliation |
| Attendance and Leave | Employee and review workflows | Attendance and leave views | Clock, review, approval, or rejection | Personnel history is retained |

Master-data mutations require the existing manage-users permission. APIs enforce authorization and relationship checks even when action buttons are hidden. Deleted sheet records do not cause IDs to be renumbered or reused.

Transaction records use lifecycle operations because hard deletion would break financial, personnel, encoder, or approval history.

**Exception: Administrator permanent delete (October 8, 2026).** For test data and records entered by mistake, an Administrator can delete a New Sale, collection, member or remittance permanently, with everything that belongs to it (shown before deleting, reason and the word DELETE required). Entries that are part of a remittance need that remittance deleted first; a deleted remittance returns its entries to Outstanding. Each deleted row stays in the Audit Log and the reason in Record Corrections. See [system guide](system-guide.md#member-transfers-and-master-data) and `lib/admin-delete.ts`.
