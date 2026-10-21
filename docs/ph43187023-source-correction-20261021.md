# PH-43187023 source-history correction — October 21, 2026

The owner requested fixing this member. All investigation and verification ran through aggregate-only scripts; individual source/member records and backups remain in ignored private files.

The member has one account and nine collections, with no New Sale. All nine source identities, amounts and dates matched. All nine saved month/NOP spans differed from the original source-covered months. Eight source program labels also differed from the current account, but Audit Log confirmed earlier program changes on those same receipts to the current program. The repair therefore retained the current program assignment and DOI.

Original source months form one continuous history. NOPs were derived from the retained DOI and current program registration rule; four original source NOP spans themselves conflict with that DOI. The resulting complete history passed account rules before writing. No remittance-linked receipts were involved.

Applied after a rollback preview:

- Corrected nine receipt-covered month spans and nine NOP spans.
- Recomputed the account status and nine affected financial snapshots.
- Preserved all receipt IDs, OR labels/dates, amounts, member/account/program links, branch, MAS and other unaffected fields.
- No remittance expectation changed; no member, account or receipt was added or deleted.

An independent readback verified all nine corrected receipts and financial snapshots, the saved account status, one Record Corrections entry and ten changed records in Audit Log. Exact before/after snapshots and correction IDs are saved privately by the script.

Commands:

- Review and prepare: `node scripts/prod.mjs node scripts/review-member-private.mjs PH-43187023`.
- Preview: `node scripts/prod.mjs node scripts/repair-other-program-source.mjs --member=PH-43187023`.
- Apply: append `--apply`.
- Independent verification: append `--verify`.

The member-scoped repair uses serializable isolation, a member-specific advisory lock and locked account/history rows. It checks every reviewed account and receipt field before writing and verifies unaffected fields, financial snapshots, Audit Log and Record Corrections before committing. Output contains counts and verification flags only.
