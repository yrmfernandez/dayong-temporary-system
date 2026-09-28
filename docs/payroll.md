# Payroll

Finance pays employees from **Payroll** (`/payroll`). Administrators and Finance prepare and pay; the CEO and President can review.

## Pay setup (Pay rates tab)

Every employee who should be paid needs a pay setup. Active employees without one are listed as **Needs pay setup** and are left out of payroll (the draft says who was skipped).

| Field | Meaning |
| --- | --- |
| Base pay | **Daily rate**, **Monthly salary**, or **No base** (commission only, typical for MAS) |
| Earns commissions | Adds the employee's pending Commissions records (already net of Fidelity) |
| Hours per day | Converts the daily rate to an hourly rate for overtime, late, and undertime (default 8) |
| Overtime multiplier | Default 1.25 (regular-day overtime) |

Monthly salaries convert to a daily rate as **salary × 12 ÷ 313**, because attendance runs Monday to Saturday. MAS can be commission-only, base plus commission, or base only.

Each payroll line stores the rate it used, so changing a pay setup never changes past payroll.

## Calculation settings (per payroll)

| Setting | Effect |
| --- | --- |
| Base pay method | **Days present × daily rate**, or **Scheduled working days** (every Monday–Saturday in the period × daily rate) |
| Pay overtime | Overtime hours × hourly rate × multiplier |
| Deduct late / Deduct undertime | Minutes × per-minute rate |
| Pay approved leave | Approved leave days count as paid days |
| Deduct absences | Scheduled method only: recorded Absent/AWOL days and unpaid leave × daily rate. Days with no attendance row are not assumed absent. |
| Include commissions | Pending Commissions whose period ends on or before the payroll end date and are not already in another live payroll |

Settings can be changed on a Draft and recalculated; they lock at approval.

**Earned ref.** shows incentives earned on remitted collections in the period for comparison. It is not paid automatically. If it is higher than the commission, a Commissions record may be missing.

## Adjustments (bonuses and deductions)

Add any number of additions or deductions per employee on a Draft. Each needs a category (performance bonus, sales/production bonus, management discretion, attendance incentive or deduction, cash advance, loan repayment, shortage/accountability, other) and a reason. "Management discretion" covers pay decided by the owner. Removing an adjustment keeps its row as `removed`.

Net pay = base + overtime + commission + additions − late − undertime − absences − deductions, never below zero. A line whose deductions exceed its earnings is flagged.

## Workflow and money controls

1. **Draft**: calculated from pay setups, attendance, and commissions. Recalculate any time; old lines are kept as `replaced`.
2. **Approved**: amounts lock. A second Finance user or an Administrator must approve a payroll someone prepared.
3. **Paid**: records the pay date, cash account, branch, and reference; posts **one Payroll outflow** to Cash Transactions for the net total; marks the included commissions Paid with the payroll ID as reference.
4. **Void**: Draft or Approved only, with a reason. Its commissions become available to a new payroll. Paid payroll is corrected with a cash transaction instead.

Payroll periods cannot overlap a non-void payroll. Each employee line has a printable **payslip**.

## Google Sheets

Created by `npm run sheets:payroll` (additive): `Pay Profiles`, `Payroll Runs`, `Payroll Lines`, `Payroll Adjustments`, each followed by the encoder identity columns. Calculation rules live in `lib/payroll-calc.ts` (tested); sheet access in `lib/payroll.ts`.
