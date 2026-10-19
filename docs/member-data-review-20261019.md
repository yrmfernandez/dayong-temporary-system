# Member payment histories requiring review

Production snapshot: October 19, 2026. Initial read-only audit of 14,231 accounts and 64,106 posted receipts. Patterns identify candidates, not confirmed errors. The four owner-confirmed corrections below were subsequently applied.

## Closest matches to the D-210 HG corrections

**Applied after owner confirmation:** PH-15674914, PH-50305112, PH-60372421 and PH-60651860 now each have one D-210 HG account with status U. Moved the four shortlisted receipts and removed the four empty source accounts. All 36 receipts/PHP 9,720, coverage, NOPs, receipt dates, DOIs and MAS attribution were verified against pre-change backups. Financial snapshots recalculated without net incentive changes or linked slip changes. Scoped configuration: `config/four-d210-split-fixes-20261019.json`; read-only verification: `scripts/verify-four-d210-splits-20261019.mjs`. The remaining 15 candidates are still for review. The table below preserves the original scan findings.

Found 19 members with at least four D-210 HG receipts, only one or two receipts on another account, matching DOIs, and no same-day parallel receipt dates. The first four also have continuous NOPs across both accounts.

| Member | Other program | D-210 HG receipts | Other receipts | Continuous NOP |
| --- | --- | ---: | ---: | --- |
| PH-15674914 | D-250 FG | 9 | 1 | Yes |
| PH-50305112 | DC-260 | 8 | 1 | Yes |
| PH-60372421 | D-300 (Bracketing) | 8 | 1 | Yes |
| PH-60651860 | D-300 (Bracketing) | 7 | 1 | Yes |
| PH-21844149 | D-250 FG | 9 | 1 | No |
| PH-01574370 | D-230 | 8 | 1 | No |
| PH-22391314 | D-300 (Bracketing) | 8 | 1 | No |
| PH-42790693 | D-300 (Bracketing) | 8 | 1 | No |
| PH-62553623 | D-250 FG | 8 | 1 | No |
| PH-99331894 | D-420 | 8 | 1 | No |
| PH-28311944 | D-420 | 6 | 1 | No |
| PH-33970911 | D-420 | 6 | 1 | No |
| PH-27546468 | D-350 | 7 | 2 | No |
| PH-44114325 | D-250 FG | 7 | 2 | No |
| PH-86724786 | D-250 FG | 7 | 2 | No |
| PH-22427452 | D-420 | 6 | 2 | No |
| PH-16977444 | D-250 FG | 5 | 2 | No |
| PH-20876335 | D-250 FG | 5 | 2 | No |
| PH-92852056 | D-250 FG | 5 | 2 | No |

### Source checks for the four closest matches

Original workbook: `legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx`. Receipt source rows were matched by normalized receipt number and checked against account metadata. The source itself has the mixed program labels; the owner subsequently confirmed D-210 HG for these four cases.

| Member | Receipt to review | Source location | Recorded program | Sequence evidence |
| --- | --- | --- | --- | --- |
| PH-15674914 | 5075 M, PHP 250 | M1-COLL row 243 | D-250 FG | January NOP 17; next receipt 6657 M, row 1504, is D-210 HG February NOP 18. Remaining D-210 receipts continue through October NOP 26. |
| PH-50305112 | 24468 C, PHP 260 | M3-COLL row 16100 | DC-260 | September NOP 26 follows D-210 HG August NOP 25 on 22580 C, row 14270. |
| PH-60372421 | 11669 C, PHP 300 | M3-COLL row 1925 | D-300 (Bracketing) | January NOP 8 follows into D-210 HG February NOP 9 on 12187C, row 3565; subsequent D-210 receipts continue through September NOP 16. |
| PH-60651860 | 21993 C, PHP 300 | M3-COLL row 16393 | D-300 (Bracketing) | September NOP 26 follows D-210 HG August NOP 25 on 20935 C, row 14586. |

## Wider scan

- Related-program families: 209 member/family combinations, including 33 strong alternating-history patterns, 54 continuous sequences, and 122 requiring closer source review. Families include D-350 variants, D-420 variants, D-460 variants and D-300 variants. These counts are not additive with the other scans.
- General equal-rate scan: 122 split-account sequences; zero receipt/account program disagreements and zero under/over-rate matches to another existing fixed-rate account.
- Coverage screen: 572 accounts with possible earlier-year coverage shifts, including 186 with multi-month January receipts. These may represent legitimate arrears. Receipt dates alone do not authorize changing covered months.
- Stored-status differences were also detected but are not treated as confirmed errors: status changes with time, and old stored snapshots can differ from live calculations.

## Reproduce

Use `npm run prod -- node scripts/find-d210-split-histories.mjs` for the targeted scan. Full receipt/account metadata is written to `legacy-data/d210-split-review-2026-10-19.json` and the compact table to its `.md` counterpart.

Other existing read-only scanners: `find-misfiled-program-receipts.mjs`, `find-split-program-candidates.mjs`, and `find-shifted-coverage.mjs`. Generated review JSON/Markdown stays under the ignored `legacy-data` directory. The related-family scanner retains its older October 14 output filename; the embedded generatedAt identifies this October 19 run.

Before applying any candidate: confirm the intended program; inspect the complete history, sales and linked remittances; save a backup; run a scoped correction as a rollback dry run; then apply and verify receipt counts, totals, coverage and status.
