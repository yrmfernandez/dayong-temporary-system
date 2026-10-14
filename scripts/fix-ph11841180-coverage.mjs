/** Owner-confirmed coverage, October 14, 2026. Dry run unless --apply; receipt dates and amounts stay intact. */
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, monthIndex, monthName } from '../lib/account-rules.ts';

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const member = 'PH-11841180';
const enrollment = 'ENR-LEG-9DF1F64EC1';
const expected = [
  ['10310C', '2026-01-23', 210, 1],
  ['13312C', '2026-02-27', 210, 1],
  ['14133C', '2026-03-23', 210, 1],
  ['9947M', '2026-04-22', 210, 1],
  ['16663C', '2026-05-23', 210, 1],
  ['21532CDUPLICATED', '2026-08-02', 630, 3],
  ['24358C', '2026-09-13', 210, 1],
];
class DryRun extends Error {}
try {
  await sql.begin(async tx => {
    await tx`select set_config('app.user_name', 'Owner-confirmed payment coverage correction', true)`;
    const [a] = await tx`select mp.*, mp.doi::text as doi, p.base_pay::float8 as rate, p.pay_balance_total::float8 as total, p.flexible, p.max_monthly_payment::float8 as maximum from member_programs mp join members m on m.member_id=mp.member_id join programs p on p.program_id=mp.program_id where mp.enrollment_id=${enrollment} and m.member_number=${member} for update of mp`;
    if (!a || a.doi !== '2024-06-01' || a.program_id !== 'DP-0005') throw new Error('Account or DOI/program differs; stop for review.');
    const rows = await tx`select collection_id, member_id, or_key, or_number, or_date::text as or_date, amount_collected::float8 as amount, nop_from, nop_to, month_from, month_to, status from collections where enrollment_id=${enrollment} order by or_date,collection_id for update`;
    // A later October receipt was encoded in production after the initial check; carry the same correction forward.
    const plan = rows.some(r => r.or_key === '26171C') ? [...expected, ['26171C', '2026-10-11', 210, 1]] : expected;
    if (rows.length !== plan.length) throw new Error('Unexpected number of payments; stop for review.');
    let nextMonth = monthIndex('2026-01');
    const after = plan.map(([key, date, amount, count]) => {
      const r = rows.find(row => row.or_key === key || (key === '21532CDUPLICATED' && row.or_key === '21532C'));
      if (!r || r.member_id !== a.member_id || r.or_date !== date || r.amount !== amount || r.status !== 'Posted') throw new Error(`Unexpected receipt data: ${key}`);
      const month_from = monthName(nextMonth), month_to = monthName(nextMonth + count - 1);
      const nop_from = nextMonth - monthIndex(a.doi.slice(0, 7)) + 1;
      nextMonth += count;
      return { ...r, month_from, month_to, nop_from, nop_to: nop_from + count - 1 };
    });
    const status = accountState({ id: enrollment, memberId: a.member_id, memberNumber: member, programId: a.program_id, doi: a.doi, branch: '', mas: '', basePay: a.rate, payBalanceTotal: a.total, storedStatus: a.account_status, flexible: a.flexible, maxMonthlyPayment: a.maximum }, after.map(r => ({ id: r.collection_id, enrollmentId: enrollment, orDate: r.or_date, orNumber: r.or_number, monthFrom: r.month_from, monthTo: r.month_to, nopFrom: r.nop_from, nopTo: r.nop_to, amount: r.amount, dateRemitted: '', mas: '' })), '2026-10-14').status;
    const changed = after.filter(r => { const old = rows.find(p => p.collection_id === r.collection_id); return ['month_from', 'month_to', 'nop_from', 'nop_to'].some(k => old[k] !== r[k]); });
    console.log(JSON.stringify({member, apply, changed: changed.length, statusBefore: a.account_status, statusAfter: status, coverage: after.map(r => ({or: r.or_number, date: r.or_date, amount: r.amount, from: r.month_from, to: r.month_to, nop: [r.nop_from,r.nop_to]}))},null,2));
    if (!changed.length && a.account_status === status) return;
    for (const r of changed) await tx`update collections set month_from=${r.month_from},month_to=${r.month_to},nop_from=${r.nop_from},nop_to=${r.nop_to} where collection_id=${r.collection_id}`;
    await tx`update member_programs set account_status=${status} where enrollment_id=${enrollment}`;
    const stamp = new Date().toISOString();
    await tx`insert into record_corrections ${tx({ correction_id: `COR-COV-${member}-${Date.now().toString(36).toUpperCase()}`, module: 'Payment coverage', record_id: enrollment, reason: 'Owner confirmed October 14, 2026: 10310 C covers January; 21532 C (duplicated) is one receipt paid August 2 covering June, July and August. Remaining receipts follow the supplied sequence through September; later receipt 26171C continues into October if present. Receipt ownership, dates and amounts unchanged.', before_json: { payments: rows, status: a.account_status }, after_json: { payments: after, status }, corrected_at: stamp, encoded_by_name: 'Owner-confirmed payment coverage correction', encoded_at: stamp })}`;
    if (!apply) throw new DryRun();
  });
  console.log(apply ? 'Applied (or already correct).' : 'No changes needed.');
} catch (e) { if (e instanceof DryRun) console.log('Dry run rolled back.'); else throw e; }
finally { await sql.end(); }
