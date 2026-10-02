# Fidelity Savings

Fidelity is a voluntary savings benefit. It is the employee's **own money**, handed to the Entry Clerk with a batch. It is not taken from incentives.

- The Entry Clerk records the amount with a Collections or New Sales batch (or on the Remittance for batches encoded without it). Zero is allowed and there is **no limit**.
- Fidelity is **added to the total remittance**: the cash expected from the batch is the company remittance plus the Fidelity. Incentives and commissions are not reduced.
- Any accountable employee (MAS or Collector) may give Fidelity. It counts once the remittance is approved.
- **The first ₱10,000 of the balance is locked** until the employee leaves the company (employment status no longer Active, such as resigned or inactive). Contributions continue past ₱10,000.
- **Anything above ₱10,000 can be withdrawn any time.** Finance or an Administrator records an **Excess Withdrawal** of up to the amount above ₱10,000.
- When an employee has left, Finance or an Administrator records a **Separation Release** of the whole balance.
- Every contribution and withdrawal stores its encoder and timestamp. The older "Claim" records (from the previous release-at-₱10,000 rule) still count as money paid out.

## My Fidelity vs Fidelity monitoring

- **My Fidelity** (`/fidelity/me`) always shows only the signed-in employee's own savings: balance, the locked amount, what can be withdrawn now, pending amounts, total withdrawn, and their history. It is under My Portfolio for MAS and under My HR for every other role, and uses `GET /api/fidelity?scope=me`.
- **Fidelity** (`/fidelity`) is company-wide monitoring for Administrator, Finance, CEO, and President. Finance or an Administrator records withdrawals there (`PATCH /api/fidelity` with `kind: "excess"` and an amount, or `kind: "separation"`). Other roles opening `/fidelity` are redirected to My Fidelity.

## Where it shows

- Collections and New Sales: the batch summary shows company remittance + Fidelity = total remittance.
- Remittances: Fidelity is part of the expected amount and of "Cash received in full". The remittance remarks say "Fidelity ₱… (employee's own money), included in the expected amount".
- Reports show approved Fidelity in its own column. Report net and expected remittance are the company's share; Fidelity is taken back out of the approved cash when comparing.
- Commissions are no longer reduced by Fidelity (the Commissions page shows it only for reference).
