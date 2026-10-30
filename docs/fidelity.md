# Fidelity Savings

Fidelity is a voluntary savings benefit. It is the employee's **own money**, handed to the Entry Clerk with a batch. It is not taken from incentives.

- The Entry Clerk records the amount with a Collections or New Sales batch (or on the Remittance for batches encoded without it). Zero is allowed and there is **no limit**.
- Fidelity is **added to the total remittance**: the cash expected from the batch is the company remittance plus the Fidelity. Incentives and commissions are not reduced.
- Any accountable employee (MAS or Collector) may give Fidelity. It counts once the remittance is approved.
- **Nothing is locked (owner, October 30, 2026).** The first ₱10,000 of the balance is the **base**; anything above it is the **excess**. Contributions continue past ₱10,000. Finance or an Administrator records, at any time, whether the employee is still employed or has left:
  - a **Base Withdrawal** from the first ₱10,000, by **percentage** (of the base the employee holds now: 50% of ₱10,000 is ₱5,000, 25% of a ₱8,000 base is ₱2,000) or by **fixed amount**, up to the base. A percentage is kept with the payout ("50% of ₱10,000.00") and shown in the history;
  - an **Excess Withdrawal** of up to the amount above ₱10,000;
  - a **Full Withdrawal** of the whole balance.
- The balance is one amount: after any payout the base and excess are worked out again from what is left (₱13,000 less a ₱5,000 base withdrawal leaves ₱8,000, all base).
- Every contribution and withdrawal stores its encoder and timestamp. The older "Claim" records (from the release-at-₱10,000 rule) and "Separation Release" records (from the October 2 to October 29 rule, when the first ₱10,000 was locked until the employee left) still count as money paid out.

## My Fidelity vs Fidelity monitoring

- **My Fidelity** (`/fidelity/me`) always shows only the signed-in employee's own savings: balance, the excess above ₱10,000, pending amounts, total withdrawn, and their history. It is under My Portfolio for MAS and under My HR for every other role, and uses `GET /api/fidelity?scope=me`.
- **Fidelity** (`/fidelity`) is company-wide monitoring for Administrator, Finance, CEO, and President. Finance or an Administrator records withdrawals there (`PATCH /api/fidelity` with `kind: "base"` plus `mode: "percent"` or `"fixed"` and `amount`, `kind: "excess"` and an amount, or `kind: "full"`). Other roles opening `/fidelity` are redirected to My Fidelity.

## Where it shows

- Collections and New Sales: the batch summary shows company remittance + Fidelity = total remittance.
- Remittances: Fidelity is part of the expected amount and of "Cash received in full". The remittance remarks say "Fidelity ₱… (employee's own money), included in the expected amount".
- Reports show approved Fidelity in its own column. Report net and expected remittance are the company's share; Fidelity is taken back out of the approved cash when comparing.
- Commissions are no longer reduced by Fidelity (the Commissions page shows it only for reference).

## Opening balances from the old system (October 23, 2026)

The old system's Fidelity Bond sheet (2022-2026 per Marketing Account Staff, old system only) is brought in with
`scripts/import-fidelity-opening-20261023.mts`. Each employee gets an **Opening Balance (old system)**, dated
2026-09-30, counted like an approved contribution. An employee who was Active and had withdrawn part of it there also
gets a **Withdrawal (old system)** of that amount, counted as paid out, so the balance is the total minus the
withdrawal. Only employees marked Active on the sheet are imported; Inactive ones are left out (owner, October 23, 2026). Every transaction now carries
a direction (in or out), which the Fidelity pages use for the + and − signs and the period totals.
