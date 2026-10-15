// Read-only inspection/verification of the six owner-confirmed D-350 receipts.
// Apply with fix-legacy-receipts.mjs --config=config/d350-receipt-correction-20261015.json --apply.
import nextEnv from '@next/env';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLegacySources } from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const receiptArg = process.argv.find(arg => arg.startsWith('--receipts='))?.slice(11);
const receipts = receiptArg ? receiptArg.split(',').map(value => value.toUpperCase().replace(/[^A-Z0-9]/g, '')) : ['10943C', '14675C', '15365C', '17109C', '19622C', '21675C'];
const memberFilter = process.argv.find(arg => arg.startsWith('--member-id='))?.slice(12) || null;
const receiptKey = value => String(value ?? '').replace(/\s*\((duplicated|to be checked)\)\s*$/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const programs = await sql`select program_id, program_code, program_name, base_pay::float8 as rate, pay_balance_total::float8 as total, flexible from programs where program_code ilike '%350%' or (${Boolean(receiptArg)} and (program_code ilike '%210%' or program_code ilike '%300%')) order by program_id`;
  console.log(JSON.stringify({ programs }));
  const payments = await sql`select c.collection_id, c.enrollment_id, c.member_id, c.program_id, p.program_code, c.or_number, c.or_date::text as date, c.amount_collected::float8 as amount, c.nop_from, c.nop_to, c.month_from, c.month_to, c.status from collections c left join programs p on p.program_id=c.program_id where upper(regexp_replace(regexp_replace(c.or_number, '[[:space:]]*[(](duplicated|to be checked)[)][[:space:]]*$', '', 'i'), '[^a-zA-Z0-9]', '', 'g')) in ${sql(receipts)} and (${memberFilter}::text is null or c.member_id=${memberFilter}) order by c.or_date`;
  console.log(JSON.stringify({ payments }));
  const expectedProgram = process.argv.find(arg => arg.startsWith('--expected-program-id='))?.slice(22);
  if (expectedProgram) {
    if (payments.length !== receipts.length || new Set(payments.map(p => receiptKey(p.or_number))).size !== receipts.length || payments.some(p => p.program_id !== expectedProgram) || new Set(payments.map(p => p.enrollment_id)).size !== 1) throw new Error('Receipts do not all belong to the expected program account.');
    const expectedTotal = process.argv.find(arg => arg.startsWith('--expected-total='))?.slice(17);
    if (expectedTotal && payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) !== Math.round(Number(expectedTotal) * 100)) throw new Error('Receipt total differs from expected.');
    console.log('Verified requested receipt count, program account, and expected total.');
  }
  if (process.argv.includes('--verify')) {
    if (receiptArg) throw new Error('--verify is specific to the original D-350 correction.');
    if (payments.length !== receipts.length || new Set(payments.map(p => p.or_number.toUpperCase().replace(/[^A-Z0-9]/g, ''))).size !== receipts.length || payments.some(p => p.program_code !== 'D-350') || new Set(payments.map(p => p.enrollment_id)).size !== 1) throw new Error('Receipts are not all on one D-350 account.');
    for (let i = 1; i < payments.length; i++) if (payments[i].nop_from !== payments[i - 1].nop_to + 1) throw new Error('Payment coverage is not continuous.');
    if (payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) !== 315000) throw new Error('Receipt total changed.');
    console.log('Verified: six D-350 receipts; continuous NOP 39–47; total PHP 3,150 unchanged.');
  }
  const sales = await sql`select s.sale_id, s.member_number, s.program_id, p.program_code, s.or_number, s.or_date::text as date, s.amount_paid::float8 as amount from sales s left join programs p on p.program_id=s.program_id where upper(regexp_replace(s.or_number, '[^a-zA-Z0-9]', '', 'g')) in ${sql(receipts)}`;
  console.log(JSON.stringify({ sales }));
  const memberIds = [...new Set(payments.map(p => p.member_id))];
  if (memberIds.length) {
    const accounts = await sql`select mp.enrollment_id, mp.member_id, mp.program_id, p.program_code, mp.doi::text as doi, mp.account_status, (select count(*)::int from collections c where c.enrollment_id=mp.enrollment_id) as payments, (select count(*)::int from member_transfers mt where mt.enrollment_id=mp.enrollment_id) as transfers, (select count(*)::int from sales s where s.member_number=mp.member_number and s.program_id=mp.program_id) as sales from member_programs mp join programs p on p.program_id=mp.program_id where mp.member_id in ${sql(memberIds)} order by mp.member_id, p.program_code`;
    console.log(JSON.stringify({ accounts }));
    if (process.argv.includes('--backup')) {
      mkdirSync('backups', { recursive: true });
      const rows = await sql`select * from collections where enrollment_id in ${sql(accounts.map(a => a.enrollment_id))}`;
      const enrollments = await sql`select * from member_programs where enrollment_id in ${sql(accounts.map(a => a.enrollment_id))}`;
      writeFileSync(`backups/${receiptArg ? 'receipt-inspection' : 'd350-receipts'}-${Date.now()}.json`, JSON.stringify({ rows, enrollments }, null, 2));
      console.log('Saved pre-correction backup.');
    }
  }
  if (process.argv.includes('--verify-histories')) {
    const { accountState, todayInManila } = await import('../lib/account-rules.ts');
    const enrollmentIds = [...new Set(payments.map(p => p.enrollment_id))];
    for (const id of enrollmentIds) {
      const [account] = await sql`select mp.enrollment_id as id, mp.member_id as "memberId", mp.member_number as "memberNumber", mp.program_id as "programId", mp.doi::text as doi, mp.branch, mp.mas, mp.account_status as "storedStatus", p.base_pay::float8 as "basePay", p.pay_balance_total::float8 as "payBalanceTotal", p.flexible, p.max_monthly_payment::float8 as "maxMonthlyPayment", p.program_code from member_programs mp join programs p on p.program_id=mp.program_id where mp.enrollment_id=${id}`;
      const history = await sql`select collection_id as id, enrollment_id as "enrollmentId", or_date::text as "orDate", or_number as "orNumber", month_from as "monthFrom", month_to as "monthTo", nop_from as "nopFrom", nop_to as "nopTo", amount_collected::float8 as amount, date_remitted::text as "dateRemitted", mas from collections where enrollment_id=${id} and status='Posted'`;
      const state = accountState(account, history, todayInManila());
      console.log(JSON.stringify({ verifiedHistory: id, program: account.program_code, paymentCount: history.length, status: state.status, lastCoveredMonth: state.lastCoveredMonth }));
      if (process.argv.includes('--show-history')) console.log(JSON.stringify({ enrollmentId: id, history: history.map(p => ({ id: p.id, receipt: p.orNumber, date: p.orDate, amount: p.amount, nopFrom: p.nopFrom, nopTo: p.nopTo, monthFrom: p.monthFrom, monthTo: p.monthTo })) }));
    }
    if (payments.length !== receipts.length) throw new Error('Expected exactly one collection per requested receipt.');
  }
  if (process.argv.includes('--source-references')) {
    const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
    const key = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const source of sources) for (const tab of source.tabs) {
      const [header, ...rows] = tab.rows, column = header.findIndex(value => key(value) === 'ORNUMBER');
      if (column < 0) continue;
      for (const [index, row] of rows.entries()) if (receipts.includes(key(row[column]))) console.log(JSON.stringify({ receipt: key(row[column]), sourceRef: `Data-Base-Old|${tab.title}|${tab.firstRow + index + 1}` }));
    }
  }
} finally { await sql.end({ timeout: 1 }); }
