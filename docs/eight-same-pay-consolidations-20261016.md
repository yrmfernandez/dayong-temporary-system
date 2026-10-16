# Eight confirmed same-base-pay consolidations

Owner confirmed October 16, 2026 that the reviewed split histories belong to the following programs. `DPB-3350` for PH-33232128 was interpreted as DPB-350, matching the reviewed pair and existing account; that assumption was stated before applying.

| Member | Correct program | Moved receipt | Resulting receipts | Gross total |
| --- | --- | --- | ---: | ---: |
| PH-27768403 | D-300 (Bracketing) | 9277 C | 10 | PHP 3,000 |
| PH-27952257 | DPB-350 | 12195N | 10 | PHP 3,500 |
| PH-33232128 | DPB-350 | 4371 M | 10 | PHP 3,500 |
| PH-86433206 | DPB-350 | 13912N | 10 | PHP 3,500 |
| PH-86648724 | DPB-350 | 14161N | 10 | PHP 3,500 |
| PH-13726515 | D-460 (59B) | 7758T | 9 | PHP 4,140 |
| PH-15157588 | DPB-350 | 16826 B | 9 | PHP 3,150 |
| PH-18906028 | DPB-420 | 24423 C | 9 | PHP 3,780 |

Pre-change backups were saved with `scripts/member-accounts.mjs --show-payments --backup`. Each emptied source account held only the reviewed receipt, with no New Sale or transfer. The eight empty accounts were removed; PH-86433206's separate D-300 (Bracketing) account remains. Existing DOIs, receipt dates, amounts and actual cash were preserved. The destination histories total 77 receipts and PHP 28,070. All eight destination accounts calculate as `U` on October 16.

The initial all-eight dry run rolled back because D-460 (59B) has no first-year incentive tiers: current MAS 10% and Collector 0% tiers cover only NOP 13–60. No rates were invented. Seven members were applied with `config/seven-same-pay-consolidations-20261016.json` after a successful dry run. PH-13726515 was applied separately with `config/ph13726515-d46059b-20261016.json`: its moved receipt is NOP 15 and can be priced using the configured tier. Its unchanged earlier payments retain their existing financial figures; NOP 7–12 still need first-year configuration for full financial repricing.

For that narrow correction the consolidation script accepts `financeScope: "changed"`: it still reprices every moved receipt and every payment whose NOP changed, while leaving unrelated unchanged history alone. The default continues to reprice the complete destination history. Missing tiers on any affected receipt still stop the transaction.

Across the seven full-history corrections, 67 financial entries changed and one already matched. One additional entry changed for PH-13726515. No linked remittance expectation needed adjustment. Audit Log and Record Corrections retain the changes.

Post-commit checks verified each moved receipt's target program and unchanged amount, plus all eight complete payment histories. A financial dry run using `config/eight-same-pay-finance-verification-20261016.json` verified 68 receipts across the seven fully repriced accounts, unchanged PHP 23,930 gross, incentives PHP 5,729, company share PHP 18,201, and zero further changes. PH-13726515's history and moved receipt were verified separately because its first-year incentive configuration is incomplete.
