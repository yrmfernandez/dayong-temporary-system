/** Owner-confirmed OR numbers, October 14, 2026. Dry run unless --apply. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const cases = [
  { id: 'COL-LEG-78D27F390F', member: 'PH-03674816', before: '21532C', after: '21533 C' },
  { id: 'COL-LEG-88CEF14B57', member: 'PH-11841180', before: '21532CDUPLICATED', after: '21532 C' },
];
const key = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
class DryRun extends Error {}
try {
  await sql.begin(async tx => {
    await tx`select set_config('app.user_name', 'Owner-confirmed OR correction', true)`;
    const ids = cases.map(c => c.id);
    const rows = await tx`select c.collection_id,c.member_id,m.member_number,c.or_number,c.or_key,c.legacy_duplicate,c.or_date::text as or_date,c.amount_collected::float8 as amount,c.month_from,c.month_to,c.nop_from,c.nop_to,c.status from collections c join members m on m.member_id=c.member_id where c.collection_id in ${tx(ids)} for update of c`;
    const conflicts = await tx`select collection_id,or_number from collections where or_key in ('21532C','21533C') and collection_id not in ${tx(ids)}`;
    const saleConflicts = await tx`select sale_id,or_number from sales where upper(regexp_replace(coalesce(or_number,''),'[^A-Za-z0-9]','','g')) in ('21532C','21533C')`;
    if (conflicts.length || saleConflicts.length) throw new Error(`Receipt conflict: ${JSON.stringify({collections:conflicts,sales:saleConflicts})}`);
    let changes = 0;
    for (const item of cases) {
      const before = rows.find(r => r.collection_id === item.id);
      if (!before || before.member_number !== item.member || before.or_date !== '2026-08-02' || before.amount !== 630 || before.status !== 'Posted' || ![item.before,key(item.after)].includes(before.or_key)) throw new Error(`Unexpected receipt data for ${item.member}; stopped.`);
      const after = { ...before, or_number:item.after, or_key:key(item.after), legacy_duplicate:false };
      console.log(JSON.stringify({member:item.member,before:before.or_number,after:after.or_number,duplicateBefore:before.legacy_duplicate,duplicateAfter:false,coverage:[before.month_from,before.month_to],date:before.or_date,amount:before.amount}));
      if (before.or_number === after.or_number && !before.legacy_duplicate) continue;
      await tx`update collections set or_number=${item.after},legacy_duplicate=false where collection_id=${item.id}`;
      const stamp = new Date().toISOString();
      await tx`insert into record_corrections ${tx({ correction_id:`COR-OR-${item.id}-${Date.now().toString(36).toUpperCase()}`, module:'OR number correction', record_id:item.id, reason:'Owner confirmed October 14, 2026: PH-03674816 receipt is 21533 C; PH-11841180 receipt is 21532 C, so its duplicate label and flag are removed. Amounts, dates and coverage are preserved.', before_json:before,after_json:after,corrected_at:stamp,encoded_by_name:'Owner-confirmed OR correction',encoded_at:stamp })}`;
      changes++;
    }
    const verified = await tx`select collection_id,or_number,or_key,legacy_duplicate from collections where collection_id in ${tx(ids)}`;
    if (!cases.every(c => verified.some(r => r.collection_id===c.id && r.or_number===c.after && r.or_key===key(c.after) && r.legacy_duplicate===false))) throw new Error('Verification failed.');
    console.log(`${changes} correction(s); ${apply ? 'committing' : 'dry run'}.`);
    if (!apply && changes) throw new DryRun();
  });
} catch(e) { if (e instanceof DryRun) console.log('Rolled back.'); else throw e; }
finally { await sql.end(); }
