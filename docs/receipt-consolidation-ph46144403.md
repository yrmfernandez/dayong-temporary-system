# PH-46144403 D-350 (5Y) consolidation

Owner confirmed October 14, 2026: OR 4308 B belongs to D-350 (5Y) and the other program account should be removed. The PHP 350 receipt dated April 15, 2026 was the only payment on D-350, ENR-LEG-AD47EA7FF7 (DP-0013). It moved to the existing D-350 (5Y) account ENR-LEG-E04F2E35A9 (DP-0009), retaining April coverage / NOP 4.

Applied on staging and production using `scripts/consolidate-member-receipts.mjs` after successful dry runs; case archived in `config/receipt-consolidations.json`. All eight collection receipts now cover February–September 2026 in receipt-date order, NOP 2–9: 12028C, 13866 C, 4308 B, 4150 B, 17990 C, 19707 C, 21013 C, 23730 C. May–September coverage was advanced to continue after the restored April installment. Receipt dates and PHP 350 amounts were preserved.

The original January 13, 2026 DOI and New Sale (application 25B-606, PHP 350) remain. The empty D-350 account had no New Sale and was removed. Status recalculated to U. A read-only production verification checked the single remaining account, all eight receipts, exact monthly/NOP sequence and retained New Sale. Changes are recorded in Audit Log and Record Corrections. Other members and the shared program definitions are unchanged.
