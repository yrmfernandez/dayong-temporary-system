# Collections and MAM implementation

This implements the clarified account rules and the later month-range/remittance request. The supplied [UI reference](mam-ui-reference.md) guides the report layout; its sample financial values are illustrative, not policy.

## Collections

- Amount Collected is read-only and equals covered months multiplied by the program's base pay. The server independently validates the amount and NOP coverage.
- NS allows editing NOP From/To. Non-NS locks them and the API checks the expected next NOP. Each entry has its own loaded status/history, with stale selection responses ignored.
- Payments cover full installments in continuous month order. The implementation starts a new account's coverage in its DOI month and requires subsequent payments to start with the next unpaid month. This is the chosen default to prevent advancing while skipping arrears.
- Collector entries require Original MAS / Officer Name. The separate Collected By Role is saved; it is not inferred from the signed-in encoder.
- Suspended accounts require the existing Waiver selection. Forfeited accounts cannot pay, even with a waiver. OR Date cannot be future-dated, precede DOI, or precede the account's latest recorded OR Date; older corrections require review rather than changing the ordinary forward-entry workflow.
- Calendar dates use Asia/Manila's current date. The clock starts from DOI before first collection, otherwise the last OR Date. An advance payment extends it to the DOI day of the last covered month. Nonexistent days clamp to month-end. Suspension begins at two calendar months; forfeiture at six calendar months plus one day.

## Remittance

The user's formula is applied **per NOP**:

```text
total = base pay - mark up
total1 = total - (total × incentive percentage)
remittance = total - total1 + mark up
```

For base pay 350, mark up 50, and 50%, remittance is **200**, while gross collection is **350**. At 30%, remittance is **140**. The term “remittance” follows the user's definition; it is not silently replaced with the gross-minus-incentive complement.

Use the configured MAS or Collector tier for each NOP. A multi-month payment crossing a tier boundary uses each month's applicable tier. Existing fixed tiers use fixed incentive amount plus mark up. Round each month's amount to centavos before summing. Missing, overlapping, invalid, or over-gross tiers block submission rather than defaulting to zero.

New columns preserve existing positions:

| Sheet | Columns | Purpose |
| --- | --- | --- |
| Member programs | S | Account Status, now including Forfeited |
| Collections | Z | Collected By Role |
| Collections | AA:AB | Remittance Amount; per-NOP JSON calculation snapshot |
| Remittances | K:L | Gross Collection; Total Remittance |

The server saves collection calculation snapshots so later incentive changes do not rewrite previously stored remittances. Remittance, collection rows, and resulting account statuses are submitted in one atomic Sheets batch. Encoder metadata remains attached to each transaction.

## MAM

`/mam` defaults to the current month and allows up to 120 months per selected range. Each month is a horizontal column, with account identity fixed on the left. It includes Branch/MAS grouping, Program/Status/Search filters, totals, account payment details, printing, and CSV export.

- Historical months calculate at month-end using receipts with OR Dates on or before that date; the current month calculates as of today. This is a reconstruction from current records, not an immutable “what staff knew then” snapshot.
- Future columns are explicitly marked Projected and use only payments received by today.
- Amount received is counted once in the OR month. Monthly coverage is calculated from the stored Month From/To and NOP From/To ranges. An advance-covered month does not acquire a fake collection.
- Account status and NOP are calculated per enrollment. Delinquency labels stop at 150D; temporary suspension is shown separately; Forfeited blocks payment.
- TMD uses the monthly program rate × NOP, not the enrollment's Amount Paid field.
- The summary quota uses balances in the final displayed month. Its collection rate uses actual OR-month collections in that same final month divided by that quota. Range collections are labelled separately. Active count excludes suspended, forfeited, not-yet-enrolled, and uncalculable accounts.
- Forfeited balances display as unavailable and are excluded from quota; no new forfeiture-balance formula is invented.
- **Sync current statuses** updates only today's derived Account Status values, regardless of the displayed historical range. Reads calculate fresh values but do not write sheets; there is no background scheduler.

## Existing-data and concurrency limits

Historical rows are not rewritten by schema migration. Invalid dates, overlapping coverage/NOP, gaps, and amounts inconsistent with the current program rate are flagged for review, not silently corrected or treated as fully paid months. No historical program-rate or MAS-assignment history exists yet: the report groups by current enrollment MAS and uses current program rates. Rate changes require explicit historical handling before old accounts can be recalculated reliably.

Payment allocations are generated in memory from the authoritative stored ranges, not saved to a duplicate transaction table. New Sales remains excluded from collection NOP.

Duplicate receipts/coverage are checked against history and earlier items in the same submission. Google Sheets does not provide a compare-and-set transaction across the initial read and the final batch write: simultaneous saves from different application instances can still race. Full distributed concurrency control requires additional infrastructure; the atomic write prevents partial batches but does not claim to solve that race.

## Verification and operation

- `npm run test:accounts`: business-rule, remittance, range-report, authorization, and encoder regression tests using mocked persistence.
- `npm run sheets:accounts`: schema dry run; append `-- --apply` to apply the non-destructive header migration.
- `npx tsc --noEmit`, targeted ESLint, and `npm run build` check application integration.

The migration preserves existing account and payment values. Tests do not create live transactions. Deploy the updated application to make these behaviors available on the hosted site.
