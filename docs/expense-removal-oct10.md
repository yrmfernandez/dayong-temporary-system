# October 10, 2026 expense removal

Owner requested removal from the report on October 14, 2026. The single matching posted expense was EXP-20261014044025-7EED: HINATUAN, PHP 278, FOOD FOR PIG, category Other: 5KG STARTER UP, expense date October 10. No linked cash transactions were found.

Applied to production with `scripts/remove-oct10-expense.mjs` after a successful dry run. Uses the existing expense Voided lifecycle from `lib/finance-data.ts`; reports in `lib/reports.ts` include only Posted expenses, so the expense no longer contributes to report totals. Amount and source information remain for audit history. The void reason and time are stored, the database Audit Log records the update and Record Corrections contains the before/after summary.

A repeat production run verified the record was already voided. The script validates the exact expense ID/date/amount/branch/description, refuses linked posted cash records, defaults to rollback, and commits only with `--apply`.
