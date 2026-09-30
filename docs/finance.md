# Finance implementation

Finance uses three operational sources rather than asking users to encode the same money twice:

- Approved `Remittances` become cash inflows.
- Posted `Expenses` become cash outflows.
- `Cash Transactions` stores other manual movements such as capital, deposits, withdrawals, and adjustments.

The consolidated Cash Ledger is generated from those sources. Users must not re-enter an approved remittance or posted expense as a manual transaction.

## Expense records

The entry form follows the company expense form: Branch, Date of Expense, Account Name, Amount, Attachments, Invoice/Receipt No., Purpose, Approved by, and Remarks. Choices live in `lib/expense-options.ts`:

- **Account Name** (`category`): Transportation, Meals/Snacks, Electric Bill, Water Bill, Internet/Load, Monthly Office Rent, Bank Fee/Charge, Cash Burial Assistance, Allowance, Office Supplies, Cash Advance, Miscellaneous, Other. "Other" must be specified and is saved as `Other: <detail>`.
- **Attachments** (column V `attachments`): a checklist of the supporting documents (Voucher, Invoice, Receipt, MC Minutes, Other), saved comma-separated. Files themselves are kept on paper; no upload is stored.
- **Approved by** (column W `approved_by`): VP Finance, CEO/President, or Other with a name.
- **Purpose** is saved in `description`; **Invoice/Receipt No.** in `receipt_number`.

Payee, payment method, payment reference and "Paid from" are optional payment details. "Paid from" defaults to Cash on Hand, which is how the expense leaves the cash ledger. Run `npm run sheets:expense-fields -- --apply` once to add columns V and W; expenses saved earlier read as no attachments and no approver recorded.

Each expense also keeps a stable ID, status, creation timestamp, encoder identity, and void history.

## Cash records

Each manual cash record has a stable ID, date, inflow/outflow direction, category, description, amount, branch, cash account, reference type and ID, status, remarks, creation timestamp, encoder identity, and void history.

Financial records are never deleted through the application. Authorized users void an entry with a reason, preserving its history. The current temporary authorization for voiding is `manage_users`; replace it with a dedicated finance permission when granular permissions are introduced.

Run `npm run sheets:finance -- --apply` to create or verify the migration-ready `Expenses` and `Cash Transactions` tabs. The configured live workbook was migrated on 2026-09-26.
