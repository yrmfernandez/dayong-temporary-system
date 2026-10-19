# NOP sequence corrections — October 19, 2026

The owner requested fixes similar to PH-84237783. Applied in production after a rollback dry run: 43 accounts with 363 incorrect NOP ranges, totaling PHP 106,395 in receipts. Covered months and month counts already matched the source. The corrected NOPs align with the existing DOI and at least 80% of later source NOP ranges. In-transaction checks and separate post-commit readback passed for every case, with no net incentive change and no remittance slip changes. All covered months and receipt fields were verified against the backup; recalculated financial snapshots were verified against the saved pricing plan.

Only single-account members with at least six matched source receipts were eligible. Every source ID, receipt number, date and amount matched. Prior explicit coverage/NOP exceptions and previously corrected histories were excluded, except the earlier Month of-only sweep whose NOPs had deliberately been preserved. Receipt dates, amounts, months, program/ownership, DOI, branch/MAS and remittance links/status remain intact; NOP-dependent financial snapshots are recalculated using existing shared rules.

## Account list

| Member | Program | Receipts | Previous NOP | Correct NOP | Preserved coverage | DOI |
| --- | --- | ---: | --- | --- | --- | --- |
| PH-03318050 | DPB-350 | 9 | 4–12 | 6–14 | 2026-01–2026-09 | 2025-08-01 |
| PH-04127465 | D-280 | 7 | 31–39 | 32–40 | 2026-01–2026-09 | 2023-06-01 |
| PH-05237426 | D-210 HG | 9 | 3–11 | 18–26 | 2026-01–2026-09 | 2024-08-01 |
| PH-05568487 | D-300 (Bracketing) | 9 | 12–20 | 13–21 | 2026-01–2026-09 | 2025-01-01 |
| PH-05805937 | D-210 HG | 9 | 12–20 | 20–28 | 2026-01–2026-09 | 2024-06-01 |
| PH-07890649 | D-210 HG | 7 | 18–25 | 17–24 | 2026-01–2026-08 | 2024-09-01 |
| PH-08259414 | D-230 | 9 | 35–43 | 52–60 | 2026-01–2026-09 | 2021-10-01 |
| PH-09541785 | D-350 | 9 | 42–50 | 43–51 | 2026-01–2026-09 | 2022-07-01 |
| PH-11108550 | D-210 HG | 7 | 14–22 | 13–21 | 2026-01–2026-09 | 2025-01-01 |
| PH-11231871 | DPB-525 | 9 | 4–12 | 5–13 | 2026-01–2026-09 | 2025-09-01 |
| PH-17912759 | D-230 | 9 | 38–46 | 52–60 | 2026-01–2026-09 | 2021-10-01 |
| PH-21814591 | D-300 (Bracketing) | 10 | 16–25 | 15–24 | 2026-01–2026-10 | 2024-11-01 |
| PH-25002583 | DFP-550 | 9 | 42–50 | 43–51 | 2026-01–2026-09 | 2022-07-01 |
| PH-25750269 | D-190 | 7 | 55–62 | 54–61 | 2026-01–2026-08 | 2021-08-01 |
| PH-31416768 | D-280 | 9 | 26–34 | 38–46 | 2026-01–2026-09 | 2022-12-01 |
| PH-38815511 | D-210 HG | 10 | 12–21 | 17–26 | 2026-01–2026-10 | 2024-09-01 |
| PH-40340774 | D-230 | 9 | 40–48 | 48–56 | 2026-01–2026-09 | 2022-02-01 |
| PH-43403172 | D-210 HG | 7 | 20–27 | 21–28 | 2026-01–2026-08 | 2024-05-01 |
| PH-43653025 | D-250 FG | 6 | 16–24 | 17–25 | 2026-01–2026-09 | 2024-09-01 |
| PH-48032467 | D-210 HG | 6 | 15–22 | 14–21 | 2026-01–2026-08 | 2024-12-01 |
| PH-49649075 | D-210 HG | 8 | 22–30 | 21–29 | 2026-01–2026-09 | 2024-05-01 |
| PH-52245695 | D-210 HG | 9 | 19–27 | 18–26 | 2026-01–2026-09 | 2024-08-01 |
| PH-55812978 | D-300 (Bracketing) | 9 | 4–12 | 5–13 | 2026-01–2026-09 | 2025-09-01 |
| PH-59282401 | D-230 | 9 | 23–31 | 52–60 | 2026-01–2026-09 | 2021-10-01 |
| PH-59404783 | D-300 (Bracketing) | 10 | 15–24 | 16–25 | 2026-01–2026-10 | 2024-10-01 |
| PH-59871585 | D-210 HG | 8 | 4–12 | 9–17 | 2026-01–2026-09 | 2025-05-01 |
| PH-62267949 | D-190 | 9 | 65–73 | 66–74 | 2026-01–2026-09 | 2020-08-01 |
| PH-64664255 | D-210 HG | 8 | 12–19 | 11–18 | 2026-01–2026-08 | 2025-03-01 |
| PH-67126945 | DFP-480 | 9 | 41–49 | 46–54 | 2026-01–2026-09 | 2022-04-01 |
| PH-68850341 | D-210 HG | 9 | 14–22 | 13–21 | 2026-01–2026-09 | 2025-01-01 |
| PH-72397478 | D-210 HG | 6 | 31–42 | 30–41 | 2026-01–2026-12 | 2023-08-01 |
| PH-74292418 | DPB-350 | 8 | 6–16 | 5–15 | 2026-01–2026-11 | 2025-09-01 |
| PH-78182125 | D-230 | 10 | 12–21 | 52–61 | 2026-01–2026-10 | 2021-10-01 |
| PH-78742945 | D-280 | 9 | 12–20 | 24–32 | 2026-01–2026-09 | 2024-02-01 |
| PH-78802289 | D-230 | 9 | 42–50 | 47–55 | 2026-01–2026-09 | 2022-03-01 |
| PH-82458940 | D-230 | 9 | 17–25 | 47–55 | 2026-01–2026-09 | 2022-03-01 |
| PH-83114757 | D-320 | 8 | 15–23 | 17–25 | 2026-01–2026-09 | 2024-09-01 |
| PH-84115386 | DPB-350 | 8 | 1–10 | 2–11 | 2026-01–2026-10 | 2025-12-01 |
| PH-87651303 | D-230 | 9 | 13–21 | 54–62 | 2026-01–2026-09 | 2021-08-01 |
| PH-89882032 | D-270 (300) | 6 | 34–41 | 33–40 | 2026-01–2026-08 | 2023-05-01 |
| PH-91527293 | D-350 | 10 | 33–42 | 34–43 | 2026-01–2026-10 | 2023-04-01 |
| PH-98649946 | D-190 | 8 | 64–72 | 63–71 | 2026-01–2026-09 | 2020-11-01 |
| PH-98727457 | D-210 HG | 9 | 19–27 | 18–26 | 2026-01–2026-09 | 2024-08-01 |

## Evidence and verification

Source workbook: legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx. Complete reviewed row references and source NOP text: legacy-data/source-nop-review-20261019.json. Full pre-change backup: backups/source-nop-repair-20261019-1792381879839.json. Backup includes the reviewed plan, every account/collection field, and calculated finance changes. Per-account Record Corrections IDs begin COR-NOP-20261019-; Audit Log records each update.

Audit: npm run prod -- node scripts/audit-source-month-coverage.mjs --nop-only. Repair dry run: npm run prod -- node scripts/repair-source-month-coverage.mjs --nop-only; --apply commits. Read-only verification: npm run prod -- node scripts/repair-source-month-coverage.mjs --nop-only --verify. Receipts mapped to remittance slips are excluded from this repair. Reapplication stops on changed reviewed values or a subsequent correction. Source parser tests and script syntax checks passed.
