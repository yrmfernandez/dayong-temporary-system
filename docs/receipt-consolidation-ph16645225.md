# PH-16645225 D-350 (5Y) consolidation

Owner confirmed October 14, 2026: only D-350 (5Y) belongs to this member; merge the other programs. Applied on staging and production with `scripts/consolidate-member-receipts.mjs` after successful dry runs. DPB-350 account ENR-LEG-1A83F84064 and D-350 account ENR-LEG-F8B65F7FEA were emptied into D-350 (5Y), DP-0009 / ENR-LEG-C6231CF9D5, then removed. Neither extra account had a New Sale.

Original DOI March 18, 2026 and New Sale (application 2026 M-156, PHP 350) remain. The six PHP 350 collections now cover April–September 2026 in receipt-date order, NOP 2–7: 3901 M, 3927 B, 08528 B, 11519 B, 13962 B, 13985 B. Original dates, amounts and incentive/remittance values were preserved. Status recalculated to U.

A read-only production verification confirmed one account, all six receipt keys/amounts/links/months/NOPs, and the retained New Sale. Changes are recorded in Audit Log and Record Corrections. The case is archived under `applied` in `config/receipt-consolidations.json`. Other members and shared program definitions are unchanged.
