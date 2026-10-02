# Payroll

Finance pays employees from **Payroll** (`/payroll`). Administrators and Finance prepare and pay; the CEO and President can review.

## Pay setup (Pay rates tab)

Every employee who should be paid needs a pay setup. Active employees without one are listed as **Needs pay setup** and are left out of payroll (the draft says who was skipped).

| Field | Meaning |
| --- | --- |
| Base pay | **Daily rate**, **Monthly salary**, or **No base** (commission only, typical for MAS) |
| Earns commissions | Adds the employee's pending Commissions records (Fidelity is the employee's own money and is not deducted) |
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

Use **Adjust** on an employee in a Draft, choose **Add to pay (+)** or **Deduct from pay (−)**, then a type, amount and reason. The form stays open so several entries (for example SSS, PhilHealth and Pag-IBIG) can be added in a row, and it previews the employee's net pay before saving.

- **Additions:** performance bonus, sales/production bonus, 13th month pay, holiday/special day pay, allowance, attendance incentive, salary adjustment/back pay, management discretion (pay decided by the owner), other addition.
- **Deductions:** SSS, PhilHealth and Pag-IBIG (HDMF) employee shares, withholding tax, SSS loan, Pag-IBIG loan, company program, cash advance, company loan repayment, shortage/accountability, attendance deduction, other deduction.

Contribution amounts are entered by Finance from the current SSS, PhilHealth and Pag-IBIG tables; the system does not compute them. Choosing a contribution, tax or company-program type fills a standard reason for the pay period, which can be edited. A **company program** deduction requires the program (for an employee enrolled in one of the company's own plans); its code and name are saved at the start of the reason, so they appear on the payslip. Every entry needs a reason of 3–300 characters. Removing an adjustment keeps its row as `removed`. Older entries recorded under retired categories ("Loan repayment", "Other") still display as recorded.

Net pay = base + overtime + commission + additions − late − undertime − absences − deductions, never below zero. A line whose deductions exceed its earnings is flagged.

## Workflow and money controls

1. **Draft**: calculated from pay setups, attendance, and commissions. Recalculate any time; old lines are kept as `replaced`.
2. **Approved**: amounts lock. A second Finance user or an Administrator must approve a payroll someone prepared.
3. **Paid**: records the pay date, cash account, branch, and reference; posts **one Payroll outflow** to Cash Transactions for the net total; marks the included commissions Paid with the payroll ID as reference.
4. **Void**: Draft or Approved only, with a reason. The payroll stays on record as Void and its commissions become available to a new payroll. Paid payroll is corrected with a cash transaction instead.
5. **Delete draft**: a Draft made by mistake can be deleted. Its run, lines and adjustments are removed from the sheets (each deleted row is kept in the Audit Log). Approved and Paid payroll cannot be deleted.

Payroll periods cannot overlap a non-void payroll. Each employee line has a printable **payslip**.

## Google Sheets

Created by `npm run sheets:payroll` (additive): `Pay Profiles`, `Payroll Runs`, `Payroll Lines`, `Payroll Adjustments`, each followed by the encoder identity columns. Calculation rules live in `lib/payroll-calc.ts` (tested); sheet access in `lib/payroll.ts`.
