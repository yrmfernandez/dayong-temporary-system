/** Owner-confirmed same person, D-210 HG and D-300 Bracketing (October 21, 2026).
 * Preview executes then rolls back. Add --apply; prefix with node scripts/prod.mjs for production.
 * Backup first with scripts/inspect-member-pair.mjs PH-46732266 PH-95168214.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import { repriceEntries } from '../lib/entry-finance.mjs';
import { isDeepStrictEqual } from 'node:util';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const reason = 'Owner confirmed PH-46732266 and PH-95168214 are one person with D-210 HG and D-300 Bracketing. Retain PH-46732266; move September OR 24381 C from duplicate DC-300 to existing D-300 Bracketing, preserving receipt amount, dates, NOP and coverage; remove redundant member/account.';
class Rollback extends Error {}
try {
  await sql.begin(async (tx) => {
    await tx`lock table members, member_programs, collections, sales in share row exclusive mode`;
    await tx`select set_config('app.user_name', 'Owner-confirmed member merge', true)`;
    const [keep] = await tx`select * from members where member_number = 'PH-46732266' for update`;
    const [other] = await tx`select * from members where member_number = 'PH-95168214' for update`;
    if (!keep) throw new Error('Retained member missing.');
    if (!other) { console.log('Duplicate member absent; nothing to merge.'); return; }
    if (keep.member_id !== 'MEM-LEG-C2FCAC479B' || other.member_id !== 'MEM-LEG-F6E5F221B4') throw new Error('Member IDs differ from backup.');
    if (keep.birthdate && other.birthdate && String(keep.birthdate) !== String(other.birthdate)) throw new Error('Conflicting birthdates.');
    const before = await tx`select * from collections where member_id in (${keep.member_id}, ${other.member_id}) order by collection_id`;
    const accounts = await tx`select * from member_programs where member_id in (${keep.member_id}, ${other.member_id}) order by enrollment_id`;
    if (accounts.length !== 3 || before.length !== 15) throw new Error('Reviewed account/receipt counts changed.');
    const target = accounts.find((a) => a.enrollment_id === 'ENR-LEG-9235A0AC31' && a.member_id === keep.member_id && a.program_id === 'DP-0067');
    const source = accounts.find((a) => a.enrollment_id === 'ENR-LEG-31A2B877F0' && a.member_id === other.member_id && a.program_id === 'DP-0026');
    const moved = before.filter((c) => c.member_id === other.member_id);
    if (!target || !source || moved.length !== 1 || moved[0].collection_id !== 'COL-LEG-D5B0145752' || Number(moved[0].amount_collected) !== 300 || moved[0].linked_remittance_id) throw new Error('Reviewed source receipt changed.');
    const extraSales = await tx`select sale_id from sales where member_number = ${other.member_number}`;
    if (extraSales.length) throw new Error('Unexpected New Sales on duplicate member.');
    await tx`update collections set member_id = ${keep.member_id}, member_number = ${keep.member_number}, enrollment_id = ${target.enrollment_id}, program_id = ${target.program_id} where collection_id = ${moved[0].collection_id}`;
    await tx`update member_transfers set member_id = ${keep.member_id}, member_number = ${keep.member_number}, enrollment_id = ${target.enrollment_id}, program_id = ${target.program_id} where member_id = ${other.member_id}`;
    await tx`update beneficiaries set member_id = ${keep.member_id} where member_id = ${other.member_id}`;
    const filled = [];
    for (const field of ['member_contact', 'address', 'birthplace', 'gender', 'civil_status', 'claimant_name', 'claimant_contact', 'claimant_address']) {
      if (!String(keep[field] ?? '').trim() && String(other[field] ?? '').trim()) {
        await tx`update members set ${tx({ [field]: other[field] })} where member_id = ${keep.member_id}`;
        filled.push(field);
      }
    }
    await tx`delete from member_programs where enrollment_id = ${source.enrollment_id}`;
    await tx`delete from members where member_id = ${other.member_id}`;
    const finance = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: [moved[0].collection_id] });
    const after = await tx`select * from collections where member_id = ${keep.member_id} order by collection_id`;
    if (after.length !== before.length) throw new Error('Receipt count mismatch.');
    for (const original of before) {
      const saved = after.find((c) => c.collection_id === original.collection_id);
      const allowed = original.collection_id === moved[0].collection_id
        ? new Set(['member_id', 'member_number', 'enrollment_id', 'program_id', 'remittance_amount', 'remittance_breakdown', 'forfeited_incentive']) : new Set();
      for (const field of Object.keys(original)) if (!allowed.has(field) && !isDeepStrictEqual(original[field], saved?.[field])) throw new Error(`${original.collection_id}: unexpected change to ${field}.`);
    }
    const finalAccounts = await tx`select enrollment_id, program_id from member_programs where member_id = ${keep.member_id} order by program_id`;
    if (finalAccounts.length !== 2 || finalAccounts[0].program_id !== 'DP-0005' || finalAccounts[1].program_id !== 'DP-0067') throw new Error('Final programs differ.');
    await tx`insert into record_corrections ${tx({ correction_id: `COR-MMG-PH46732266-${Date.now().toString(36).toUpperCase()}`, module: 'Member and program consolidation', record_id: keep.member_number, reason,
      before_json: { member: other.member_id, memberNumber: other.member_number, account: source.enrollment_id, receipt: moved[0] },
      after_json: { member: keep.member_id, memberNumber: keep.member_number, account: target.enrollment_id, program: target.program_id, filled, finance },
      corrected_at: new Date().toISOString(), encoded_by_name: 'Owner-confirmed member merge', encoded_at: new Date().toISOString() })}`;
    console.log(`PH-95168214 -> PH-46732266; 2 programs, 15 receipts, PHP ${after.reduce((sum, c) => sum + Number(c.amount_collected), 0)}. Receipt dates/amounts/NOPs/coverage preserved.`);
    console.log(`Moved OR 24381 C to D-300 Bracketing; ${finance.changes.length} financial snapshot(s) recalculated, ${finance.slips.length} remittance expectations updated.`);
    if (!apply) throw new Rollback();
  });
  console.log('Applied/verified.');
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log('Preview verified; all changes rolled back. Add --apply to write.');
} finally { await sql.end(); }
