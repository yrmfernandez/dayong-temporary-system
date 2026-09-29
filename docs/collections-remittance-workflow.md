# Collections and Remittance workflow

This document supersedes the earlier behavior where saving a collection batch also created a Remittances row.

## Definitive accounting flow

`Member Payment -> Collection -> Collector/MAS Accountability -> Remittance -> Verification -> Approval -> Cleared Accountability`

- A Collection is one member payment. It is written immediately and does not require remittance approval to exist.
- A Remittance is a physical cash turnover. It references existing Collections and never creates member payments.
- The accountable person is the Collector or MAS who holds the cash, not the Entry Clerk who encoded it.
- A submitted Remittance does not clear accountability. Only approval changes linked Collections to `Remitted`.
- Gross selected Collections determine the expected turnover. The incentive calculation remains a separate reference and does not reduce cash accountability.

## Remittance penalty

A penalty is charged to the accountable MAS or Collector (for example, for a late turnover). They pay it from their own money; members are never charged. It is entered once per Collection batch, in the batch header, with a required note of what it is for (3–300 characters).

- It is stored on the batch's first Collection row (Collections AJ `penalty_amount`, AK `penalty_note`), so a Remittance counts it exactly once.
- Expected Amount = the selected Collections' remittance amounts + the penalty + Fidelity. The full-cash check, outstanding accountability, and reports use the same total.
- The incentive and Fidelity calculations are unchanged; the penalty is never treated as member payment or incentive.
- Every remittance that includes a penalty shows it and its note: in the Collections totals, the Remittances selection list, Pending Approval, and Records (Penalty column), and in the Remittances sheet remarks ("Includes penalty ₱X: note").

Run `npm run sheets:remittance-penalty` for a dry run and `-- --apply` to add the two Collections headers.

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
- The submitting user cannot decide the same Remittance through Pending Approval.
- **Cash received in full:** any user who can open Remittances may tick it when the actual cash equals the expected amount (including any penalty and Fidelity) to the centavo. The server then creates the Remittance already Approved in one write, records the encoder as the decision maker with the note "Cash received in full and confirmed during encoding.", and marks the linked Collections Remitted.
- Approval and rejection currently require the existing administrative `manageUsers` permission until dedicated finance permissions are added.
- Approved records have no ordinary edit/delete endpoint. Future corrections require a void/reversal workflow with reason, user, and timestamp.
