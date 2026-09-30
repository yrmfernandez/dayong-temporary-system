# Executive dashboard

CEO and President users land on a sales and performance dashboard (`components/executive-dashboard.tsx`, data in `lib/executive-analytics.ts`). The period switch (month, quarter or year to date, or the last 12 months) scopes every figure except the 12-month revenue trend and the targets. Changes compare with the same span one period earlier.

## Metric definitions

| Metric | Definition |
| --- | --- |
| Gross Sales | New Sales amount paid (plus any batch penalty) + posted Collections gross |
| Net Sales | Gross Sales less agent commissions (collection gross − company remittance share) |
| EBITDA | Net Sales − paid payroll (by pay date, excluding the commission component) − posted expenses − vendor bills (by invoice date). No interest, tax, depreciation or amortization is recorded, so this equals operating profit |
| Net Profit Margin | EBITDA ÷ Gross Sales, before interest and tax |
| Cash on Hand | Active cash accounts' opening balances + approved remittances − posted expenses ± posted manual cash transactions (including payroll payouts) |
| Burn rate | Average monthly cash outflow over the last three complete months |
| Cash Runway | Cash on hand ÷ net monthly burn (outflow − inflow). "Self-funding" when inflows cover outflows |
| Recurring Dues (ARR) | Monthly program rate of every active account not Paid or Forfeited, × 12 |
| Accounts Current | Active accounts in NS, U, ADV or Paid status, as a share of all active accounts |

Vendor payments are not posted to the cash ledger by the Vendor Payables page, so they affect EBITDA (as bills) but not Cash on Hand unless recorded as a cash transaction.

## Targets

Targets are stored in the `Company Targets` sheet (`target_id` is `2026` or `2026-Q3`, plus gross sales and new-account targets). The sheet is created automatically the first time a target is saved. CEO, President and Administrator can set them from the dashboard's Targets card. Progress compares Gross Sales to date with the target; the projection assumes the current daily pace continues.
