# Collections and Remittance workflow

This document supersedes the earlier behavior where saving a collection batch also created a Remittances row.

## Definitive accounting flow

`Member Payment -> Collection -> Collector/MAS Accountability -> Remittance -> Verification -> Approval -> Cleared Accountability`

- A Collection is one member payment. It is written immediately and does not require remittance approval to exist.
- A Remittance is a physical cash turnover. It references existing Collections and never creates member payments.
- The accountable person is the Collector or MAS who holds the cash, not the Entry Clerk who encoded it.
- A submitted Remittance does not clear accountability. Only approval changes linked Collections to `Remitted`.
- Gross selected Collections determine the expected turnover. The incentive calculation remains a separate reference and does not reduce cash accountability.

## Collection remittance statuses

- `Outstanding`: available for a new Remittance and included in cash accountability.
- `Pending Remittance Approval`: linked to a submitted Remittance; restricted from another turnover.
- `Remitted`: linked to an approved Remittance and removed from outstanding accountability.
- `Needs Historical Review`: created before this workflow; excluded from current accountability until reconciled rather than guessed.

## Remittance statuses

- `Pending Approval`: submitted with expected and actual amounts equal.
- `Discrepancy`: submitted with a shortage or overage; remains available for an authorized decision.
- `Approved`: cash was verified; linked Collections become `Remitted`.
- `Rejected`: rejection reason and decision identity are recorded; linked Collections return to `Outstanding`.
- `Legacy`: an older Remittances row created by the previous automatic process. It does not prove physical turnover.

## Google Sheets records

`Collections` remains one row per member payment. Columns AC:AG store Remittance Status, Linked Remittance ID, Accountable Employee ID, Accountable Name, and Accountable Role.

`Remittances` remains one row per physical turnover. Existing A:L columns are retained for compatibility. M:X store difference, accountable identity, collection count, receiver, decision identity/time, remarks, and rejection reason.

`Remittance Collections` stores one row per relationship. Its composite business key is Remittance ID plus Collection ID; it also has its own stable row ID and encoder identity.

Run `npm run sheets:remittances` for a dry run and `npm run sheets:remittances -- --apply` to apply the schema safely.

## Controls

- A Remittance contains Collections for one accountable person and branch.
- Expected Amount is recalculated on the server from the selected Collection rows.
- The backend rechecks eligibility before submission and approval.
- The submitting user cannot decide the same Remittance.
- Approval and rejection currently require the existing administrative `manageUsers` permission until dedicated finance permissions are added.
- Approved records have no ordinary edit/delete endpoint. Future corrections require a void/reversal workflow with reason, user, and timestamp.
