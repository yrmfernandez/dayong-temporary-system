# PH-78528286 DPB-350 receipt consolidation

Owner confirmed October 14, 2026: all nine receipts belong to one DPB-350 account, in the supplied order. DP-0010 has program name DPB-350 (production program code is 350).

Applied with `scripts/consolidate-member-receipts.mjs`, driven by `config/receipt-consolidations.json`, after successful staging and production dry runs. July and August collections moved from D-350 (DP-0013) to the kept DPB-350 account ENR-LEG-DAD1849964. September's coverage was corrected from July/NOP 13 to September/NOP 15. The empty D-350 account had no New Sale and was removed; every receipt was retained.

| OR | Coverage in 2026 | NOP |
| --- | --- | --- |
| 9698 C | January | 7 |
| 11858 C | February | 8 |
| 14179 C | March | 9 |
| 9598 M | April | 10 |
| 17759 C | May | 11 |
| 18854 C | June | 12 |
| 20325 C | July | 13 |
| 23152 C | August | 14 |
| 24552 C | September | 15 |

Dates and amounts (350 per receipt) were preserved. Status recalculated to U. A read-only production query verified a single DPB-350 account and all nine receipts, amounts, program/account links and exact monthly/NOP sequence. Changes are in the Audit Log and Record Corrections. The configuration case is archived under `applied`.
