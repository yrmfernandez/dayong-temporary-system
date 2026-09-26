# Operational reports

The Reports workspace provides daily, weekly, monthly, and yearly views. Each view is generated from existing transaction sheets, so corrections to a source transaction appear in the next generated report without maintaining a second copy of the data.

## Source records and dates

| Report value | Source | Date used |
| --- | --- | --- |
| New sales | `Sales` | `date_created` |
| Collections | Posted `Collections` | `or_date` |
| Expected collection remittance | `Collections.remittance_amount` | `or_date` |
| Actual remittance | Approved `Remittances` | `remittance_date` |
| Expenses | Posted `Expenses` | `expense_date` |
| Deposits | Posted deposit inflows in `Cash Transactions` | `transaction_date` |

Collection incentive is the gross amount received less the saved remittance amount. The report assigns that incentive to the stored accountable role, either MAS or Collector. Net is gross less incentives and fidelity. Expected remittance is net less posted expenses. Difference is expected remittance less actual approved remittance, so a positive value indicates a shortage and a negative value indicates an overage.

Filters for branch, program, and MAS/Collector apply to Sales and Collections. Branch also filters Expenses, Remittances, and Deposits. Program and person filters cannot be applied to those finance records because their current schemas do not contain those dimensions.

## Report periods

- Daily shows the individual New Sales and Collection groups for the selected date.
- Weekly shows daily totals for the Monday-to-Sunday week containing the selected date.
- Monthly shows totals grouped into calendar-day bands: days 1-7, 8-14, 15-21, 22-28, and 29-end.
- Yearly shows monthly totals for the selected year.

Every report records the signed-in username and generation timestamp in the rendered result. Print uses the browser print workflow. Export produces a formula-safe UTF-8 CSV that opens in Excel.

## Current schema limits

Fidelity Bond is zero until a confirmed Fidelity Bond field or transaction source is added. New Sales incentives are also zero because no approved Sales incentive rule is stored. Collection incentives continue to use each Collection row's saved remittance calculation.

Reports do not currently persist an Open, Ready for Review, or Verified state. A verified report requires a defined reviewer, approval workflow, and immutable snapshot policy; displaying that state without stored approval evidence would be misleading.
