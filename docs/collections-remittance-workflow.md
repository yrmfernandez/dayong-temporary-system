# Collections and Remittance workflow

This document supersedes the earlier behavior where saving a collection batch also created a Remittances row.

## Definitive accounting flow

`Member Payment -> Collection -> Collector/MAS Accountability -> Remittance -> Verification -> Approval -> Cleared Accountability`

- A Collection is one member payment. It is written immediately and does not require remittance approval to exist.
- A Remittance is a physical cash turnover. It references existing Collections and never creates member payments.
- The accountable person is the Collector or MAS who holds the cash, not the Entry Clerk who encoded it.
- A submitted Remittance does not clear accountability. Only approval changes linked Collections to `Remitted`.
- Gross selected Collections determine the expected turnover. The incentive calculation remains a separate reference and does not reduce cash accountability.

## New Sales remittances

A MAS turns over New Sales on their own remittance slip, separate from Collections, so every remittance is one kind (Remittances Z `remittance_type`: `Collections` or `New Sales`; blank rows are Collections).

- Saving a New Sale makes its full amount paid owed by the sale's MAS: Sales AJ `remittance_status` starts `Outstanding`, AK `linked_remittance_id`, AL `accountable_employee_id`. There is no sales incentive, so the expected amount is the amount paid.
- On Remittances → New Remittance, choose **Collections slip** or **New Sales slip**; the accountable-person list and items follow that choice. Mixing kinds is refused. Fidelity applies to MAS Collections and New Sales slips.
- Submitting, approving, and rejecting move the sale through the same statuses as a Collection (`Pending Remittance Approval`, `Remitted`, back to `Outstanding`). The Remittances sheet, Pending Approval, and Records show each slip's type.
- A New Sale already on a remittance cannot be corrected from Entry History.

Run `npm run sheets:sales-remittance` for a dry run and `-- --apply` to add the columns (existing sales rows are marked `Needs Historical Review`).

## Batch calculation (Collections and New Sales)

Both encoding pages show the same panel before saving:

```text
Total amount collected
Total incentives   = amount collected - company remittance - MAS Fidelity
+ Penalty          (MAS's own money, with its note)
Total remittance   = company remittance + MAS Fidelity + penalty
```

New Sales earn a MAS incentive (`calculateSaleIncentive` in `lib/remittance.ts`):

- **Program with a registration fee:** the program's New Sale incentive (Programs Q type, R amount), a fixed amount or a percentage of the amount paid. None set means none earned.
- **Program without a registration fee:** the sale pays the first month, so the month-1 MAS incentive tier applies to the base pay, as for a Collection at NOP 1. Anything above one month is remitted in full; less than one month earns nothing.

Each sale stores Sales AO `mas_incentive` and AP `remittance_amount`. The Entry Clerk may enter the MAS's Fidelity for the batch (zero allowed); it must not exceed the batch's incentives or the MAS's remaining ₱10,000, and is stored on the first sale (AQ `fidelity_amount`). The total remittance is the company share plus Fidelity plus any penalty. Sales saved before incentives existed have blank AO:AQ and still owe the full amount paid. Run `npm run sheets:sale-incentives -- --apply` once to add these columns.

Every remittance that includes Fidelity says so: in the Remittances sheet remarks ("Includes MAS Fidelity ₱…, deducted from the MAS's incentives"), on the selected items, in the expected amount, on pending approvals, and in the records' MAS Fidelity column. The same total is what "Cash received in full" must match and what the Remittances page expects.

## MAS Fidelity at encoding

The Entry Clerk may enter the MAS Fidelity with a Collections batch (Collections AL `fidelity_amount`, first row of the batch). It is set aside from the batch's incentives as the MAS's savings: the incentives go down by that amount and the remittance goes up by it. It is not allowed on Collector batches (their incentive is the Collector's), may not exceed the batch's incentives, and must fit the MAS's remaining ₱10,000 lifetime limit. The remittance for that batch uses the stored amount (Remittances Y), so the Fidelity page counts it; the Remittances page shows it read-only and only asks for Fidelity on batches encoded before this field existed.

## Remittance penalty

A penalty is charged to the accountable MAS or Collector (for example, for a late turnover). They pay it from their own money; members are never charged. It is entered once per Collections batch or New Sales batch (New Sales store it in Sales AM `penalty_amount`, AN `penalty_note`), with a required note of what it is for (3–300 characters).

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
