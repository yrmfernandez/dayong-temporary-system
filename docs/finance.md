# Finance implementation

Finance uses three operational sources rather than asking users to encode the same money twice:

- Approved `Remittances` become cash inflows.
- Posted `Expenses` become cash outflows.
- `Cash Transactions` stores other manual movements such as capital, deposits, withdrawals, and adjustments.

The consolidated Cash Ledger is generated from those sources. Users must not re-enter an approved remittance or posted expense as a manual transaction.

## Expense records

Each expense has a stable ID, expense date, category, description, amount, payee, payment source, branch, payment method, reference and receipt numbers, status, remarks, creation timestamp, encoder identity, and void history.

## Cash records

Each manual cash record has a stable ID, date, inflow/outflow direction, category, description, amount, branch, cash account, reference type and ID, status, remarks, creation timestamp, encoder identity, and void history.

Financial records are never deleted through the application. Authorized users void an entry with a reason, preserving its history. The current temporary authorization for voiding is `manage_users`; replace it with a dedicated finance permission when granular permissions are introduced.

Run `npm run sheets:finance -- --apply` to create or verify the migration-ready `Expenses` and `Cash Transactions` tabs. The configured live workbook was migrated on 2026-09-26.
