# PH-69288046 D-460 (59B) consolidation

Owner confirmed October 14, 2026: receipts 5194 M, 6455 M, 8179 M, 8480 M, 6080 B, 8039 B, 11128 B, 12586 B and 14344 B belong to D-460 (59B). All nine belong to PH-69288046. April–May were on D-460; the subsequent payments on D-460 (59B) had coverage shifted back two months.

Applied on staging and production with `scripts/consolidate-member-receipts.mjs` after successful dry runs. All nine now belong to ENR-LEG-1CE5DDBD06, program DP-0022, DOI 2025-03-01, covering January–September 2026 in the supplied receipt-date order, NOP 11–19. The empty D-460 account ENR-LEG-DE707905A3 had no New Sale and was removed. No shared program definition was changed.

Original receipt dates and PHP 460 amounts were preserved (PHP 4,140 total), as were existing incentive/remittance values. Status recalculated to U. A read-only production check verified the single account and all nine receipt keys, amounts, program/account links, coverage and NOPs. Changes are in Audit Log and Record Corrections. Configuration is archived under `applied` in `config/receipt-consolidations.json`.
