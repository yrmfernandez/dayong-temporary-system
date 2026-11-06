# Collections and Remittance workflow

This document supersedes the earlier behavior where saving a collection batch also created a Remittances row.

## Current flow (October 4, 2026)

Entry Clerks no longer create remittance slips or approve cash:

Receipt form display (October 15, 2026): Collections and New Sales entry cards use solid theme-aware surfaces without the animated masked glass border. Collections' sticky save bar also uses a solid surface instead of live backdrop blur, and the shared receipt picker bounds previews to 40 × 40 pixels. These changes address cards turning white when local receipt attachments are added.

Cards turning white, real cause (October 15, 2026): the receipt picker's file input was visually hidden (`sr-only`) but focusable; when the file picker closed, the browser focused it and scrolled the overflow-hidden form card to show it, so the form slid up and left the card blank below the save bar. The input is now `display: none`, opened by a button, and the Collections panels use `overflow-clip` (cannot be scrolled). The earlier changes (solid entry cards, no masked light-edge overlay on cards, solid save bars) stay; they were not the cause.

1. Saved New Sales and Collections are `Outstanding` and appear in My Entries as *Needs receipt photo*.
2. Attaching receipt photos (Collections form, My Entries, or Today's Entries) sends ready entries to approval on their own: a Collections batch as one slip once every Collection in it has a photo, New Sales one by one. The slip is created by "System", expects exactly the cash due (company share, or the full amount after the incentive deadline, plus any batch Fidelity), and is dated the batch's Date Remitted.
3. Approvers approve or reject one, the selected, or all slips in Remittances → Pending Approval. Approval needs every receipt photo.
4. Rejected entries become `Returned` with the reason, shown in My Entries. **Edit batch** opens them on the Collections or New Sales form itself; the clerk fixes them there and resubmits them; a new photo also resubmits.

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

## No incentive on one entry (October 20, 2026)

Each New Sale and each Collection on the encoding forms has a **No incentive** button. Clicking it means the MAS or Collector earns no incentive on that one entry, and a **Reason for no incentive** box (at least 3 characters, up to 300) appears and is required. Click again to undo. The button is not shown on a DTO batch, which earns no incentive anyway, or on the MAS's own New Sales submissions.

- **Saving.** The entry's whole amount is its company share (`remittance_amount`). For New Sales, `mas_incentive` is 0. The incentive it would have earned is stored in `forfeited_incentive`, so reports count it as a forfeited incentive. The reason is saved in `no_incentive_reason` (migration 0025, on `sales` and `collections`). The batch's total remittance, and so the control total from the turnover sheet, includes the whole amount. The server enforces all of this, and the form's preview matches it.
- **Kept.** Repricing on Edit / Corrections, finance repricing and returned-batch edits keep the entry remitted whole (`lib/entry-edit.ts`, `lib/entry-finance.mjs`, `lib/batch-edit.ts`). A rejected slip gives late-cash forfeits back but not a No incentive one (`noIncentiveReasons` in `lib/remittance-workflow.ts`).
- **Shown.** Today's Entries shows a *No incentive* badge with the reason, and the entry details (also in My Entries) list it. Remittances → View entries shows *No incentive: reason*.

## Editing a returned batch on the full form (November 6, 2026)

**Edit batch** in My Entries opens a Returned batch on the Collections or New Sales form, with everything as it was saved and a banner giving the reason it was returned. Saving goes through `saveReturnedBatch` (`lib/batch-edit.ts`), not a new encoding: saved entries keep their IDs, receipt photos and encoder, every change goes to Record Corrections, and the batch stays Returned until it is resubmitted. The clerk then comes back to My Entries.

- **Collections.** Everything on the form can change: the member and program of a collection, OR number and date, amount, months, Reactivation, Transferred, Waiver, No incentive, Different incentives, Date Remitted, method, Collected by, ORC, penalty and Fidelity. Collections can be removed and **added**. A collection moved to another member or program continues that account from its next month.
- **Branch and MAS stay on Collections,** because the cash and handover are recorded against them. A collection can go only to an active account of the batch's branch and MAS (of the branch, on a DTO batch). A batch that belongs to another MAS is deleted by an administrator and encoded again.
- **An added collection** passes every check of encoding, joins the batch as Returned under the batch's encoder and encoded day, and goes back with it on resubmitting. On a bank or e-wallet batch it needs a receipt photo.
- **New Sales.** Everything on a sale can change, and a sale can be removed. The batch can go to another MAS of the branch cleared on the Date Remitted. New sales cannot be added to a returned batch: they are encoded as their own batch.
- **Not asked again.** The turnover control total belongs to the first save. Late dates are judged from the day the batch was first encoded.
- **Receipt photos.** The batch keeps them, so none is required. Adding a photo on the form sends the batch back for approval, as a new photo in My Entries does.
- **Drafts.** A returned batch is never kept as a form draft, so it cannot come back as a new batch, and the clerk's unfinished batch is left alone.

## Different incentives on one collection (November 6, 2026)

A program may have **Different incentives**: MAS rates kept apart from its overall and branch rates (`program_incentives.different`, migration 0046), for all branches, with no Collector share. They are set on Programs with **Add Different Incentive**.

- **Encoding.** The Entry Clerk sees a **Different incentives** tick on a collection when the batch is collected by MAS and the program has such a rate. Each collection is ticked on its own, also when reviewing a batch a MAS submitted. The form's preview uses the rate.
- **Saving.** A ticked collection is priced at the Different rate for the months it covers and at the usual overall or branch rate for the others (`tiersForBranch`, third argument), and `collections.different_incentive` is saved. The server refuses a tick on a batch not collected by MAS or on a program with no such rate. The batch's total remittance, and so the control total, follows the rate.
- **Kept.** Repricing on Edit / Corrections, finance repricing and returned-batch edits keep the rate (`lib/entry-edit.ts`, `lib/entry-finance.mjs`, `lib/batch-edit.ts`). On a returned batch the clerk can tick or untick it. It goes off if the batch stops being collected by MAS or the collection moves to a program without such a rate.
- **Other rules.** Late cash forfeits it under the 3:00 PM rule, and an Administrator's Keep or Forfeit applies, as both work from the saved company share. No incentive still remits the whole amount. A reactivation stays at 10%. A MAS's own submission is quoted at the usual rate until the clerk ticks it.
- **Shown.** Today's Entries and Remittances → View entries say *Different incentives*.

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
