# Fidelity Savings

Fidelity is a voluntary savings benefit for MAS employees. It does not apply to Collector incentives.

- The Entry Clerk manually records the amount requested by the MAS on each Remittance. The amount may be zero.
- Lifetime approved contributions stop at ₱10,000; the final amount is limited to the remaining balance.
- Savings remain locked until the ₱10,000 cap is reached.
- When Finance or an Administrator records the MAS claim, the current balance resets to zero and a new ₱10,000 savings cycle begins. The previous claim remains in the Fidelity history.
- Finance or an Administrator releases the completed savings once. Every contribution and release stores its encoder and timestamp.
- MAS users see their own balance. Finance, Administrators, CEO, and President can review all MAS balances and remittance history.

Reports show the manually encoded approved Fidelity amount separately.

## My Fidelity vs Fidelity monitoring

- **My Fidelity** (`/fidelity/me`) always shows only the signed-in employee's own savings: progress toward the cap, pending amounts, remaining balance, past claims, and their own history. It is under My Portfolio for MAS and under My HR for every other role, and uses `GET /api/fidelity?scope=me`.
- **Fidelity** (`/fidelity`) is company-wide monitoring for Administrator, Finance, CEO, and President, where Finance or an Administrator records claims. Other roles opening `/fidelity` are redirected to My Fidelity.
