# Finance implementation

Finance uses three operational sources rather than asking users to encode the same money twice:

- Approved `Remittances` become cash inflows.
- Posted `Expenses` become cash outflows.
- `Cash Transactions` stores other manual movements such as capital, deposits, withdrawals, and adjustments.

The consolidated Cash Ledger is generated from those sources. Users must not re-enter an approved remittance or posted expense as a manual transaction.

Payouts made in the app write their own Cash Transaction outflow (October 24, 2026), so they must not be entered by hand either: payroll payment (category Payroll), vendor bill payments (Vendor payment), commissions paid directly from Commissions (Commission) and Fidelity withdrawals and releases (Fidelity release). Each asks for the cash account, the branch charged and the date paid, and is saved together with its payment. A payroll company-program deduction still needs its Collection recorded separately.

## Expense records

The entry form follows the company expense form: Branch, Date of Expense, Account Name, Amount, Attachments, Invoice/Receipt No., Purpose, Approved by, and Remarks. Choices live in `lib/expense-options.ts`:

- **Account Name** (`category`, the company's list since October 22, 2026): CBA (Cash Burial Assistance), Allowances, Services MAS incentives, Services Tie-up, Vehicle Maintenance, Transportation, Permit/License, Office Supplies, Gasoline, Professional Fee, ORC, Sales incentives, Collections incentives, Office Renovations, Office Rental, Monthly Bills, Interment, Funeral Supplies/stocks, Preservation, Pull-out, Forms/Receipt, Vehicle Registration, Meals, Medical Assistance, SSS, Philhealth, Embalming Supplies, Casket Procurement, Office Maintenance/renovations, Others. "Others" must be specified and is saved as `Others: <detail>`. CBA needs the member or deceased member's name (payee). Expenses recorded under an older account keep it until moved; editing one asks for an account from this list.
- **Attachments** (column V `attachments`): a checklist of the supporting documents (Voucher, Invoice, Receipt, MC Minutes, Other), saved comma-separated. Files themselves are kept on paper; no upload is stored.
- **Approved by** (column W `approved_by`): VP Finance, CEO/President, or Other with a name.
- **Purpose** is saved in `description`; **Invoice/Receipt No.** in `receipt_number`. The receipt number is required on every expense, on the Expenses page and on an Entry Clerk's report, when saving and when editing (October 20, 2026). Every new expense, on the Expenses page and on an Entry Clerk's report, also needs at least one photo or scan of its receipt (October 21, 2026; up to 10, kept in `receipt_photos` with the expense ID). `createExpense` checks the fields and photos, saves the photos, then the expense, so none is saved without one. The register's Attachments column has a **Receipt** button per photo.
- **Cash Burial Assistance** (October 20, 2026) also requires the name of the member or deceased member it is for. It is saved in `payee` (no new column), shown as *For: name* in the Expense Register and as *Cash Burial Assistance: name* on the clerk report; the optional Payee field is hidden for this account.

Payee, payment method, payment reference and "Paid from" are optional payment details. "Paid from" defaults to Cash on Hand, which is how the expense leaves the cash ledger. Run `npm run sheets:expense-fields -- --apply` once to add columns V and W; expenses saved earlier read as no attachments and no approver recorded.

Each expense also keeps a stable ID, status, creation timestamp, encoder identity, and void history.

Entry Clerks can also add an expense from their own report (Reports, under "Add expense / other cash out"). It is saved here as an ordinary expense for the clerk's primary branch, paid from Cash on Hand, so it appears in the cash ledger and Finance can void it. The clerk's report lists the expenses they encoded under Expenses/Other Cash Out.

Cash a clerk forwards to the bank is recorded on their report in the separate `Bank Deposits` sheet (voided with a reason, never deleted). It feeds only the clerk report's Cash Flow section and Remaining Cash on Hand; it is **not** a Cash Transaction and does not change the cash ledger. Record the company's own bank deposit in Cash Transactions as before.

## Cash records

Each manual cash record has a stable ID, date, inflow/outflow direction, category, description, amount, branch, cash account, reference type and ID, status, remarks, creation timestamp, encoder identity, and void history.

Financial records are never deleted through the application. Authorized users void an entry with a reason, preserving its history. The current temporary authorization for voiding is `manage_users`; replace it with a dedicated finance permission when granular permissions are introduced.

Run `npm run sheets:finance -- --apply` to create or verify the migration-ready `Expenses` and `Cash Transactions` tabs. The configured live workbook was migrated on 2026-09-26.
