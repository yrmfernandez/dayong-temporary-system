# Collections and Remittance workflow

This document supersedes the earlier behavior where saving a collection batch also created a Remittances row.

## Current flow (October 4, 2026)

Entry Clerks no longer create remittance slips or approve cash:

1. Saved New Sales and Collections are `Outstanding` and appear in My Entries as *Needs receipt photo*.
2. Attaching receipt photos (Collections form, My Entries, or Today's Entries) sends ready entries to approval on their own: a Collections batch as one slip once every Collection in it has a photo, New Sales one by one. The slip is created by "System", expects exactly the cash due (company share, or the full amount after the incentive deadline, plus any batch Fidelity), and is dated the batch's Date Remitted.
3. Approvers approve or reject one, the selected, or all slips in Remittances → Pending Approval. Approval needs every receipt photo.
4. Rejected entries become `Returned` with the reason, shown in My Entries. The clerk fixes and resubmits them; a new photo also resubmits.

Remittances shows Dashboard, Pending Approval, and Reports. Entry Clerks see only what they encoded; approvers see everyone, with an Entry Clerk filter and search. The sections below describe the underlying calculations and sheet columns; where they mention choosing items for a slip, the system now does that automatically. Details: [system guide § 6](system-guide.md#6-remittances-and-staff-accountability).

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
- Each New Sale goes to approval on its own slip once its receipt photo is attached; mixing kinds on one slip is refused. Fidelity (the employee's own money) can be on either kind.
- Submitting, approving, and rejecting move the sale through the same statuses as a Collection (`Pending Remittance Approval`, `Remitted`, or `Returned`). The Remittances sheet, Pending Approval, and Records show each slip's type.
- A New Sale already on a remittance cannot be corrected from Entry History.

Run `npm run sheets:sales-remittance` for a dry run and `-- --apply` to add the columns (existing sales rows are marked `Needs Historical Review`).

## Batch calculation (Collections and New Sales)

Both encoding pages show the same panel before saving:

```text
Total amount collected
Total incentives   = amount collected - company remittance
Total remittance   = company remittance + Fidelity (employee's own money)

Separate from the remittance:
  Penalty          (MAS's own money, with its note)
```

Fidelity is added to the total remittance, the slip's expected amount, and outstanding accountability; it never reduces incentives (see [Fidelity](fidelity.md)). The penalty stays independent of the remittance and of report net.

New Sales earn a MAS incentive (`calculateSaleIncentive` in `lib/remittance.ts`):

- **Program with a registration fee:** the program's New Sale incentive (Programs Q type, R amount), a fixed amount or a percentage of the amount paid. None set means none earned.
- **Program without a registration fee:** the sale pays the first month, so the month-1 MAS incentive tier applies to the base pay, as for a Collection at NOP 1. Anything above one month is remitted in full; less than one month earns nothing.

Each sale stores Sales AO `mas_incentive` and AP `remittance_amount`. The Entry Clerk may enter the MAS's Fidelity for the batch (zero allowed, no limit); it is stored on the first sale (AQ `fidelity_amount`) and added to the total remittance. Any penalty is tracked separately. Sales saved before incentives existed have blank AO:AQ and still owe the full amount paid. Run `npm run sheets:sale-incentives -- --apply` once to add these columns.

Every remittance whose batch has Fidelity says so: in the Remittances sheet remarks ("Fidelity ₱… (employee's own money), included in the expected amount"), on pending approvals, and in the records. It is part of the expected amount.

## Fidelity at encoding

The Entry Clerk may enter the MAS Fidelity with a Collections batch (Collections AL `fidelity_amount`, first row of the batch). It is the accountable employee's own money saved for them: incentives are unchanged and the batch's total remittance goes up by that amount. Any batch (MAS, Collector or DTO) may have it, and there is no limit. The remittance for that batch uses the stored amount (Remittances Y), so the Fidelity page counts it.

## Remittance penalty

A penalty is charged to the accountable MAS or Collector (for example, for a late turnover). They pay it from their own money; members are never charged. It is entered once per Collections batch or New Sales batch (New Sales store it in Sales AM `penalty_amount`, AN `penalty_note`), with a required note of what it is for (3–300 characters).

- It is stored on the batch's first Collection row (Collections AJ `penalty_amount`, AK `penalty_note`), so a Remittance counts it exactly once.
- Expected Amount = the slip's Collections' cash due plus the batch's Fidelity. The penalty is independent and is not added; outstanding accountability uses the same total.
- The incentive and Fidelity calculations are unchanged; the penalty is never treated as member payment or incentive.
- Every remittance whose batch has a penalty shows it and its note, marked as separate from the remittance: in the Collections totals, Pending Approval, and the remittance records, and in the Remittances sheet remarks ("Penalty ₱X (separate from remittance): note").

Run `npm run sheets:remittance-penalty` for a dry run and `-- --apply` to add the two Collections headers.

## Collection remittance statuses

- `Outstanding`: waiting for its receipt photo (it then goes to approval automatically); included in cash accountability.
- `Pending Remittance Approval`: linked to a submitted Remittance; restricted from another turnover.
- `Remitted`: linked to an approved Remittance and removed from outstanding accountability.
- `Returned`: its Remittance was rejected; the link is kept so the reason shows in My Entries. Still in accountability until the clerk resubmits and it is approved.
- `Needs Historical Review`: created before this workflow; excluded from current accountability until reconciled rather than guessed.

## Remittance statuses

- `Pending Approval`: submitted with expected and actual amounts equal.
- `Discrepancy`: submitted with a shortage or overage; remains available for an authorized decision.
- `Approved`: cash was verified; linked Collections become `Remitted`.
- `Rejected`: rejection reason and decision identity are recorded; linked entries become `Returned` to the Entry Clerk.
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
- **Cash received in full** (a slip created already Approved) is limited to approvers and is no longer offered on the Collections form or to Entry Clerks. It does not wait for receipt photos.
- Approvers may decide several slips at once; each is decided separately and any slip that could not be decided is reported.
- Approval and rejection currently require the existing administrative `manageUsers` permission until dedicated finance permissions are added.
- Approved records have no ordinary edit/delete endpoint. Future corrections require a void/reversal workflow with reason, user, and timestamp.
