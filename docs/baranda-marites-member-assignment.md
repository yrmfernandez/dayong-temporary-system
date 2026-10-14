# Baranda, M. old-sheet member assignments

On October 14, 2026 the owner confirmed that **Baranda, M.** in the old sheet means **BARANDA, MARITES**, employee **SDS-2026-0001**, rather than BARANDA, MABEL (MD-2026-0063). The legacy importer matched surname and first initial; production had 286 old-sheet accounts for 267 members assigned to Mabel, all in HINATUAN. No old-website accounts were in that set.

`scripts/assign-baranda-m-to-marites.mjs` reassigned those accounts to Marites in production. It validates the active target, branch assignments and expected account/member counts; updates enrollment MAS name and employee link; writes one member-transfer record per account and a Record Corrections summary; and verifies all assignments in one transaction. Database triggers record changes in the Audit Log. Employee identities, logins and roles are preserved. Historical collections, sales and cash accountability remain unchanged, following the normal member-transfer behavior.

The staging guard found no matching active target state and made no changes. Production dry runs passed before applying; a repeat run verified all 286 accounts under Marites. The script defaults to rollback, commits with `--apply`, and uses the correction summary to verify already applied runs rather than repeating transfers.

```sh
npm run prod -- node scripts/assign-baranda-m-to-marites.mjs
npm run prod -- node scripts/assign-baranda-m-to-marites.mjs --apply
```

`config/legacy-migration-map.json` now pins the abbreviated forms Baranda, M. / Baranda M. (with or without the final period) to SDS-2026-0001 for future old-sheet imports. Fully spelled Mabel and Jollibe names are separate identities.
