# Collection ownership correction — October 23, 2026

The owner confirmed COL-LEG-3650697726 belongs to PH-29405174. The collection now links to that member's existing D-350 account, which has nine collections after the move. Its existing NOP and covered months fit without overlapping the receiving history.

`scripts/reassign-col3650697726.mjs` verified staging and production rollback previews before committing the production change. Only the collection's member ID, member number and enrollment link changed; both affected account statuses were refreshed. Amount, dates, program, NOPs, covered months, financial snapshots, remittance fields, other receipts and member profiles were preserved. Both account records remain. Private snapshots and backups preserve the previous ownership; Audit Log and Record Corrections record the correction.

Production readback: `node scripts/prod.mjs node scripts/reassign-col3650697726.mjs --verify`. Staging preview: `node scripts/reassign-col3650697726.mjs --staging` (requires the corresponding ignored inspection snapshot).
