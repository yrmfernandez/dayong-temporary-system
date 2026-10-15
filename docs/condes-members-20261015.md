# CONDES, MILDRED: members filed under Racho, K.

On October 15, 2026 the owner listed ten members of **CONDES, MILDRED** (`SDS-2026-0007`, Cabadbaran) and confirmed that those the old sheet filed under **Racho, K.** (`RACHO, KRISTINE`, `LEG-2026-0022`) are Condes's, and that the old-sheet members not yet in the database are to be imported. The list is in `config/condes-members-20261015.json`.

## Findings (production, read-only `scripts/check-mas-members.mjs`)

| Member | Database | Old sheet |
| --- | --- | --- |
| Sergio Bolo Momo | PH-10388693, DSP-290 Cabadbaran, under Racho | BUTUAN-NS 144, Racho |
| Estrella Milan Nanual | PH-43393530, under Racho | BUTUAN-NS 156, Racho |
| Apostolada Palarca Tapales | PH-55363708, under Racho | BUTUAN-NS 163, Racho |
| Anita Villagonzalo | PH-02486320, under Racho | BUTUAN-NS 162, Racho |
| Francisca Siscon Loque | PH-29124939 (recorded as first name "FRANCISCA SESCON"; owner: same person), under Racho | BUTUAN-NS 161, Racho |
| Eliza Laureta | PH-69937893, under Racho | BUTUAN-NS 164, Racho |
| William Bolo Momo | PH-47998887, under Racho (recorded as surname "BOLO", first name "MOMO WILLIAM": the sheet wrote the name without a comma, so the import guessed the split) | BUTUAN-NS 143, Racho |
| Marina Masbate Romaguera | not in the database | BUTUAN-NS 220, Condes |
| Teofila Gaviola | not found | not found (old sheet or old web app) |
| Arceli Polintan Paras | not found | not found |

Expected transfer: 7 accounts (the seven under Racho). Only Marina Masbate Romaguera needs importing. The check and transfer scripts match names in any word order (`scripts/name-match.mjs`), so records split like William's are found.

## Steps (owner, production)

1. Re-run the check and note whether Marina Masbate Romaguera is in the database:
   `npm run prod -- node scripts/check-mas-members.mjs --mas="CONDES, MILDRED" --names-file=config/condes-members-20261015.json`
2. Import Marina Masbate Romaguera (`BUTUAN-NS|220`, filed under Condes, M., so imported under Condes directly), dry run then `--apply`. The importer runs through `tsx` and needs the workbook named (without it, it reads only the report files directly in `legacy-data/`, and `--only-ref` finds nothing):
   `npm run prod -- npx tsx --tsconfig tsconfig.json scripts/migrate-legacy-members.mjs "legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx" --source-title=Data-Base-Old --only-ref="Data-Base-Old|BUTUAN-NS|220" --repair --fix-nop-typos`
   **Done on production (October 15, 2026):** 1 member, 1 account, 1 New Sale written under Condes (IDs in `backups/legacy-migration-ids-2026-10-15T04-00-48-187Z.json`). When `--only-ref` finds no account, the importer now prints why (row not read, with the tabs it read, or the reasons logged for the row).
3. Transfer every listed member's accounts from Racho to Condes, dry run then `--apply --expected=N`:
   `npm run prod -- node scripts/transfer-mas-members.mjs --names-file=config/condes-members-20261015.json --from=LEG-2026-0022 --to=SDS-2026-0007`
   Same records as Members → Transfer: the account's MAS changes, one Member Transfers row per account with the reason, a Record Corrections summary, and a backup. The New Sales and any collections stay with the MAS who handled them (Racho), as for any transfer.
4. Re-run step 1: every found member should read UNDER MAS.

Status: **done** (October 15, 2026). The transfer was applied on production (7 accounts, Racho → Condes) and the final check reads UNDER MAS for all eight members found: PH-47998887, PH-10388693, PH-43393530, PH-55363708, PH-02486320, PH-29124939, PH-69937893 and the imported PH-74645735 (DSP-290, Cabadbaran). Their New Sales stay credited to Racho, who handled them. Still open: Teofila Gaviola and Arceli Polintan Paras are in no source; they need an application or OR number, or must be encoded as New Sales. Follow-up: 385 old-sheet names had no comma and were split by guess on import (importer report, "Name has no comma"); such members can be hard to find by surname.
