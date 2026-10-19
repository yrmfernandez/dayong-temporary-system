# Source Month of corrections — October 19, 2026

Applied in production after a rollback dry run: 629 receipt coverage corrections across 74 accounts/members. The 629 payments total PHP 179,200; amounts and all other receipt fields are unchanged. Only Month of and calculated account status were updated. A full pre-change backup and per-account Audit Log/Record Corrections entries retain the evidence.

Verified each complete history against original source rows by deterministic source ID, receipt number, receipt date, amount and covered-month count. Source histories must begin in January 2026 and remain continuous, with unchanged NOP spans. Accounts with prior corrections, incomplete source matches, ambiguous years/spans or fewer than six posted receipts were excluded. This was a conservative repair, not a claim that every remaining history is correct.

All changed receipt rows and all account fields were compared with the pre-change backup in the transaction and again after commit. Only month_from/month_to and account_status may differ; no finance or remittance fields were changed. All 74 Record Corrections records were verified.

## Corrected accounts

| Member | Program | Receipts | Previous coverage | Correct source coverage | Status before → after | First / last source row |
| --- | --- | ---: | --- | --- | --- | --- |
| PH-00555176 | D-190 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/604; Data-Base-Old/M3-COLL/16910 |
| PH-03318050 | DPB-350 | 9 | 2025-11–2026-07 | 2026-01–2026-09 | 120D → U | Data-Base-Old/DDO 1-COLL/997; Data-Base-Old/DDO 1-COLL/8030 |
| PH-04127465 | D-280 | 7 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M1-COLL/1025; Data-Base-Old/M1-COLL/10297 |
| PH-05237426 | D-210 HG | 9 | 2024-10–2025-06 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/749; Data-Base-Old/M3-COLL/15852 |
| PH-05568487 | D-300 (Bracketing) | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1442; Data-Base-Old/M3-COLL/16956 |
| PH-05617962 | D-210 HG | 9 | 2026-02–2026-11 | 2026-01–2026-10 | ADV → U | Data-Base-Old/M1-COLL/535; Data-Base-Old/M1-COLL/9725 |
| PH-05805937 | D-210 HG | 9 | 2025-05–2026-01 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/491; Data-Base-Old/M3-COLL/15854 |
| PH-07890649 | D-210 HG | 7 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → U | Data-Base-Old/M2-COLL/1163; Data-Base-Old/M2-COLL/6831 |
| PH-08259414 | D-230 | 9 | 2024-08–2025-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1512; Data-Base-Old/M3-COLL/16993 |
| PH-09541785 | D-350 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M2-COLL/174; Data-Base-Old/M2-COLL/7570 |
| PH-09840877 | D-185 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1419; Data-Base-Old/M3-COLL/15914 |
| PH-09911891 | D-210 HG | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1183; Data-Base-Old/M3-COLL/16389 |
| PH-10993581 | D-270 (300) | 10 | 2025-12–2026-09 | 2026-01–2026-10 | 90D → U | Data-Base-Old/M3-COLL/49; Data-Base-Old/M3-COLL/17161 |
| PH-11108550 | D-210 HG | 7 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/1345; Data-Base-Old/M3-COLL/16781 |
| PH-11231871 | DPB-525 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M1-COLL/1040; Data-Base-Old/M1-COLL/10279 |
| PH-15334518 | D-210 HG | 8 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → 60D | Data-Base-Old/M3-COLL/1596; Data-Base-Old/M3-COLL/13970 |
| PH-15876376 | D-350 | 9 | 2026-03–2026-11 | 2026-01–2026-09 | ADV → U | Data-Base-Old/M3-COLL/678; Data-Base-Old/M3-COLL/15840 |
| PH-17912759 | D-230 | 9 | 2024-11–2025-07 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/858; Data-Base-Old/M1-COLL/10012 |
| PH-20423509 | D-190 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1716; Data-Base-Old/M3-COLL/16722 |
| PH-21561225 | D-190 | 9 | 2026-05–2027-01 | 2026-01–2026-09 | ADV → U | Data-Base-Old/M2-COLL/279; Data-Base-Old/M2-COLL/7163 |
| PH-21814591 | D-300 (Bracketing) | 10 | 2026-02–2026-11 | 2026-01–2026-10 | U → U | Data-Base-Old/M3-COLL/405; Data-Base-Old/M3-COLL/17257 |
| PH-25002583 | DFP-550 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/665; Data-Base-Old/M3-COLL/16420 |
| PH-25750269 | D-190 | 7 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → 60D | Data-Base-Old/M1-COLL/622; Data-Base-Old/M1-COLL/8690 |
| PH-27151605 | D-320 | 9 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M1-COLL/251; Data-Base-Old/M1-COLL/9752 |
| PH-31416768 | D-280 | 9 | 2025-01–2025-09 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1118; Data-Base-Old/M3-COLL/16423 |
| PH-38815511 | D-210 HG | 10 | 2025-08–2026-05 | 2026-01–2026-10 | 150D → U | Data-Base-Old/M1-COLL/177; Data-Base-Old/M1-COLL/10437 |
| PH-40340774 | D-230 | 9 | 2025-05–2026-01 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/177; Data-Base-Old/M3-COLL/16050 |
| PH-42016029 | D-210 HG | 9 | 2025-07–2026-03 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/782; Data-Base-Old/M1-COLL/10365 |
| PH-43250767 | D-180 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1886; Data-Base-Old/M3-COLL/16785 |
| PH-43403172 | D-210 HG | 7 | 2025-12–2026-07 | 2026-01–2026-08 | 120D → U | Data-Base-Old/M2-COLL/700; Data-Base-Old/M2-COLL/6787 |
| PH-43653025 | D-250 FG | 6 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/DDO 1-COLL/1582; Data-Base-Old/DDO 1-COLL/7508 |
| PH-48032467 | D-210 HG | 6 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → U | Data-Base-Old/DDO 1-COLL/574; Data-Base-Old/DDO 1-COLL/7175 |
| PH-49052015 | D-210 HG | 8 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/DDO 1-COLL/332; Data-Base-Old/DDO 1-COLL/7962 |
| PH-49649075 | D-210 HG | 8 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/1745; Data-Base-Old/M3-COLL/17031 |
| PH-52245695 | D-210 HG | 9 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/1613; Data-Base-Old/M3-COLL/16842 |
| PH-54240895 | D-210 HG | 8 | 2026-04–2026-12 | 2026-01–2026-09 | ADV → U | Data-Base-Old/M3-COLL/1469; Data-Base-Old/M3-COLL/16985 |
| PH-55812978 | D-300 (Bracketing) | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M2-COLL/500; Data-Base-Old/M2-COLL/7462 |
| PH-56263877 | D-210 HG | 10 | 2025-12–2026-09 | 2026-01–2026-10 | 90D → U | Data-Base-Old/M3-COLL/51; Data-Base-Old/M3-COLL/17168 |
| PH-57706902 | D-230 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1585; Data-Base-Old/M3-COLL/16647 |
| PH-59282401 | D-230 | 9 | 2023-08–2024-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/985; Data-Base-Old/M1-COLL/10425 |
| PH-59404783 | D-300 (Bracketing) | 10 | 2025-12–2026-09 | 2026-01–2026-10 | 90D → U | Data-Base-Old/M3-COLL/28; Data-Base-Old/M3-COLL/17412 |
| PH-59855843 | D-210 HG | 7 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M1-COLL/613; Data-Base-Old/M1-COLL/8955 |
| PH-59871585 | D-210 HG | 8 | 2025-08–2026-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/310; Data-Base-Old/M3-COLL/15625 |
| PH-62267949 | D-190 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/SDS-COLL/254; Data-Base-Old/SDS-COLL/4167 |
| PH-63832317 | D-230 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M2-COLL/515; Data-Base-Old/M2-COLL/7278 |
| PH-64551213 | D-190 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M1-COLL/759; Data-Base-Old/M1-COLL/9878 |
| PH-64664255 | D-210 HG | 8 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → 60D | Data-Base-Old/DDO 1-COLL/747; Data-Base-Old/DDO 1-COLL/7803 |
| PH-67126945 | DFP-480 | 9 | 2025-08–2026-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/489; Data-Base-Old/M1-COLL/9844 |
| PH-68850341 | D-210 HG | 9 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/DDO 1-COLL/1577; Data-Base-Old/DDO 1-COLL/7945 |
| PH-69972820 | D-190 | 8 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M1-COLL/1128; Data-Base-Old/M1-COLL/10153 |
| PH-72397478 | D-210 HG | 6 | 2026-02–2027-01 | 2026-01–2026-12 | ADV → ADV | Data-Base-Old/M2-COLL/49; Data-Base-Old/M2-COLL/4994 |
| PH-72778635 | D-210 HG | 9 | 2026-03–2026-11 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/1591; Data-Base-Old/M3-COLL/17351 |
| PH-74292418 | DPB-350 | 8 | 2026-02–2026-12 | 2026-01–2026-11 | ADV → ADV | Data-Base-Old/M3-COLL/2299; Data-Base-Old/M3-COLL/15711 |
| PH-74537279 | DPB-420 | 9 | 2025-10–2026-06 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/729; Data-Base-Old/M1-COLL/9826 |
| PH-75248946 | D-190 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M1-COLL/808; Data-Base-Old/M1-COLL/10015 |
| PH-76967615 | D-300 (Bracketing) | 8 | 2025-12–2026-07 | 2026-01–2026-08 | 120D → U | Data-Base-Old/M1-COLL/1112; Data-Base-Old/M1-COLL/9340 |
| PH-78182125 | D-230 | 10 | 2022-09–2023-06 | 2026-01–2026-10 | 150D → U | Data-Base-Old/M3-COLL/24; Data-Base-Old/M3-COLL/17308 |
| PH-78742945 | D-280 | 9 | 2025-01–2025-09 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1185; Data-Base-Old/M3-COLL/16253 |
| PH-78802289 | D-230 | 9 | 2025-08–2026-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1176; Data-Base-Old/M3-COLL/16016 |
| PH-82458940 | D-230 | 9 | 2023-07–2024-03 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1475; Data-Base-Old/M3-COLL/17093 |
| PH-83114757 | D-320 | 8 | 2025-11–2026-07 | 2026-01–2026-09 | 120D → U | Data-Base-Old/DDO 1-COLL/477; Data-Base-Old/DDO 1-COLL/7940 |
| PH-84115386 | DPB-350 | 8 | 2025-12–2026-09 | 2026-01–2026-10 | 60D → U | Data-Base-Old/M1-COLL/199; Data-Base-Old/M1-COLL/10260 |
| PH-84237783 | DPB-350 | 7 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/1666; Data-Base-Old/M3-COLL/15608 |
| PH-86595800 | D-280 | 7 | 2025-12–2026-09 | 2026-01–2026-10 | 60D → U | Data-Base-Old/DAVNOR-COLL/117; Data-Base-Old/DAVNOR-COLL/9054 |
| PH-87651303 | D-230 | 9 | 2022-08–2023-04 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M3-COLL/1441; Data-Base-Old/M3-COLL/16955 |
| PH-88671926 | D-230 | 8 | 2023-10–2024-06 | 2026-01–2026-09 | 150D → U | Data-Base-Old/M1-COLL/374; Data-Base-Old/M1-COLL/9895 |
| PH-89168001 | D-300 (Bracketing) | 9 | 2026-02–2026-10 | 2026-01–2026-09 | 60D → U | Data-Base-Old/M3-COLL/1408; Data-Base-Old/M3-COLL/17105 |
| PH-89882032 | D-270 (300) | 6 | 2026-02–2026-09 | 2026-01–2026-08 | 60D → U | Data-Base-Old/M3-COLL/1476; Data-Base-Old/M3-COLL/11177 |
| PH-91527293 | D-350 | 10 | 2025-12–2026-09 | 2026-01–2026-10 | 90D → U | Data-Base-Old/M3-COLL/19; Data-Base-Old/M3-COLL/17167 |
| PH-93746050 | DFP-550 | 9 | 2025-12–2026-08 | 2026-01–2026-09 | 90D → U | Data-Base-Old/M3-COLL/1161; Data-Base-Old/M3-COLL/16349 |
| PH-96854298 | D-300 (Bracketing) | 6 | 2025-12–2026-07 | 2026-01–2026-08 | 120D → U | Data-Base-Old/DDO 2-COLL/146; Data-Base-Old/DDO 2-COLL/2891 |
| PH-98649946 | D-190 | 8 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/SDS-COLL/235; Data-Base-Old/SDS-COLL/4268 |
| PH-98727457 | D-210 HG | 9 | 2026-02–2026-10 | 2026-01–2026-09 | U → U | Data-Base-Old/M3-COLL/2260; Data-Base-Old/M3-COLL/17006 |
| PH-99905750 | D-280 | 9 | 2026-03–2026-11 | 2026-01–2026-09 | ADV → U | Data-Base-Old/DDO 1-COLL/121; Data-Base-Old/DDO 1-COLL/8063 |

## Evidence and reproduction

Source: legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx. Audit plan: legacy-data/source-month-review-20261019.json. Full before-image and reviewed plan: backups/source-month-repair-20261019-1792380128692.json. These input/backup files remain local and ignored by Git. Per-account correction IDs begin COR-MONTH-20261019-.

Read-only audit: npm run prod -- node scripts/audit-source-month-coverage.mjs. Repair script defaults to rollback: npm run prod -- node scripts/repair-source-month-coverage.mjs. Post-apply verification: npm run prod -- node scripts/repair-source-month-coverage.mjs --verify. Reapplication of the reviewed plan stops if any account has since been corrected or its reviewed history changed.
