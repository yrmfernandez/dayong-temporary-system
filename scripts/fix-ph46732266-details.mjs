/** Source-verified follow-up to the October21 member merge. Dry run rolls back; --apply writes. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, todayInManila } from '../lib/account-rules.ts';
import { repriceEntries } from '../lib/entry-finance.mjs';
import { isDeepStrictEqual } from 'node:util';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
class Rollback extends Error {}
try {
  await sql.begin(async (tx) => {
    await tx`lock table members, member_programs, collections, sales in share row exclusive mode`;
    const [member] = await tx`select * from members where member_number = 'PH-46732266' for update`;
    if (!member || member.member_id !== 'MEM-LEG-C2FCAC479B') throw new Error('Member differs.');
    const accounts = await tx`select mp.*, mp.doi::text as day, p.base_pay::float8 as rate, p.pay_balance_total::float8 as total, p.flexible, p.max_monthly_payment::float8 as maximum from member_programs mp join programs p using (program_id) where member_id = ${member.member_id} order by program_id`;
    const before = await tx`select *, or_date::text as day from collections where member_id = ${member.member_id} order by collection_id`;
    const sales = await tx`select *, doi::text as day from sales where member_number = ${member.member_number}`;
    const target = accounts.find((a) => a.enrollment_id === 'ENR-LEG-9235A0AC31' && a.program_id === 'DP-0067');
    if (accounts.length !== 2 || !target || before.length !== 15 || sales.length !== 1 || sales[0].day !== '2026-03-31') throw new Error('Reviewed account/receipt/sale counts or date differ.');
    const sourceRows = JSON.parse(fs.readFileSync('legacy-data/PH-46732266-source-rows.json', 'utf8'));
    const backup = `backups/ph46732266-details-${Date.now()}.json`;
    fs.writeFileSync(backup, JSON.stringify({ member, accounts, collections: before, sales }, null, 2));
    console.log(`Backup ${backup}`);
    await tx`select set_config('app.user_name', 'Source-verified member details correction', true)`;
    const changedIds = [];
    for (const entry of before.filter((c) => c.program_id === 'DP-0067')) {
      const source = sourceRows.find((r) => r.id === entry.collection_id);
      const nop = Number(source?.source.NOP);
      if (!source || nop < 2 || nop > 7 || !Number.isInteger(nop) || Number(entry.amount_collected) !== 300 || entry.month_from !== `2026-${String(nop + 2).padStart(2, '0')}` || entry.month_from !== entry.month_to) throw new Error(`${entry.collection_id}: source/coverage differs.`);
      if (entry.nop_from !== nop || entry.nop_to !== nop) {
        await tx`update collections set nop_from = ${nop}, nop_to = ${nop} where collection_id = ${entry.collection_id}`;
        changedIds.push(entry.collection_id);
        console.log(`${entry.collection_id}: NOP ${entry.nop_from} -> ${nop}; ${entry.month_from} preserved.`);
      }
    }
    if (!['2026-03-01', '2026-03-31'].includes(target.day)) throw new Error('Unexpected account DOI.');
    await tx`update member_programs set doi = '2026-03-31' where enrollment_id = ${target.enrollment_id}`;
    console.log(`Bracketing DOI ${target.day} -> 2026-03-31 (original New Sale M3-NS row453).`);
    const today = todayInManila();
    const birth = String(member.birthdate instanceof Date ? member.birthdate.toISOString().slice(0, 10) : member.birthdate);
    if (birth !== '1996-09-08') throw new Error('Birthdate changed.');
    const age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0);
    await tx`update members set age = ${age} where member_id = ${member.member_id}`;
    console.log(`Current member age ${member.age} -> ${age}; New Sale age remains its enrollment age.`);
    const payments = await tx`select *, or_date::text as day from collections where member_id = ${member.member_id} order by collection_id`;
    const statuses = [];
    for (const account of accounts) {
      const state = accountState({ id: account.enrollment_id, memberId: member.member_id, memberNumber: member.member_number, programId: account.program_id,
        doi: account.enrollment_id === target.enrollment_id ? '2026-03-31' : account.day, branch: account.branch, mas: account.mas,
        basePay: account.rate, payBalanceTotal: account.total || 0, storedStatus: account.account_status, flexible: account.flexible, maxMonthlyPayment: account.maximum },
        payments.map((c) => ({ id: c.collection_id, enrollmentId: c.enrollment_id, orDate: c.day, orNumber: c.or_number, monthFrom: c.month_from, monthTo: c.month_to, nopFrom: c.nop_from, nopTo: c.nop_to, amount: Number(c.amount_collected), dateRemitted: '', mas: c.mas })), today);
      await tx`update member_programs set account_status = ${state.status} where enrollment_id = ${account.enrollment_id}`;
      statuses.push({ account: account.enrollment_id, before: account.account_status, after: state.status, nextNop: state.nextNop, nextMonth: state.nextMonth });
      console.log(`${account.program_id}: ${account.account_status} -> ${state.status}; next ${state.nextMonth}, NOP ${state.nextNop}.`);
    }
    const finance = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: changedIds, saleIds: sales.map((s) => s.sale_id) });
    const saved = await tx`select *, or_date::text as day from collections where member_id = ${member.member_id} order by collection_id`;
    if (saved.length !== 15) throw new Error('Receipt count changed.');
    for (const original of before) {
      const current = saved.find((c) => c.collection_id === original.collection_id);
      const allowed = new Set(changedIds.includes(original.collection_id) ? ['nop_from', 'nop_to', 'remittance_amount', 'remittance_breakdown', 'forfeited_incentive'] : []);
      for (const field of Object.keys(original)) if (!allowed.has(field) && !isDeepStrictEqual(original[field], current?.[field])) throw new Error(`${original.collection_id}: unexpected change to ${field}.`);
    }
    const correctionId = `COR-DETAIL-PH46732266-${Date.now().toString(36).toUpperCase()}`;
    await tx`insert into record_corrections ${tx({ correction_id: correctionId, module: 'Source-verified member details correction', record_id: member.member_number,
      reason: 'Owner requested fixing the merged member’s other data. Original M3-NS row453 confirms March31,2026 New Sale/DOI and birthdate; M3-COLL rows6720,8928,10936,12370,14389 confirm Bracketing April–August NOP2–6; September row16139 NOP7. Preserve paid amounts/coverage; recalculate account statuses, current age and corrected financial snapshots.',
      before_json: { age: member.age, doi: target.day, payments: before.filter((c) => changedIds.includes(c.collection_id)), statuses: accounts.map((a) => [a.enrollment_id, a.account_status]) },
      after_json: { age, doi: '2026-03-31', statuses, finance }, corrected_at: new Date().toISOString(), encoded_by_name: 'Source-verified member details correction', encoded_at: new Date().toISOString() })}`;
    console.log(`${finance.changes.length} financial snapshots recalculated; ${finance.slips.length} remittance expectations changed. Correction ${correctionId}.`);
    if (!apply) throw new Rollback();
  });
  console.log('Applied.');
} catch (error) { if (!(error instanceof Rollback)) throw error; console.log('Preview passed; rolled back. Add --apply.'); }
finally { await sql.end(); }
