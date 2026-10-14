# PH-60638126 D-460 (59B) consolidation

Owner confirmed October 14, 2026: this member has only D-460 (59B). Two imported accounts shared DOI 2025-03-01: D-460 (59B), ENR-LEG-F18DDF55A1 (DP-0022), and D-460, ENR-LEG-F430186A49 (DP-0023). January/February and June–September were on the first account; March–May were on the second, causing overlapping month/NOP coverage when considered together.

Applied on staging and production through `scripts/consolidate-member-receipts.mjs` after successful dry runs, using the case archived under `applied` in `config/receipt-consolidations.json`. All nine receipts now belong to ENR-LEG-F18DDF55A1 / DP-0022, covering January–September 2026 with NOP 11–19. The empty D-460 account, which had no New Sale, was removed. Each receipt's date and amount of PHP 460 were preserved; total payments remain PHP 4,140. Existing incentive and remittance values were preserved.

Receipt sequence: 5195 M, 6454 M, 8178 M, 8479 M, 6081 B, 8040 B, 11129 B, 12587 B, 14343 B. The account status recalculated to U under the current rules. A read-only production verification checked the single remaining account, all nine receipts, total amounts, links, exact months and NOPs. Changes are recorded in the Audit Log and Record Corrections.
