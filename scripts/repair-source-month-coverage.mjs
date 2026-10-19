/** Guarded source repair. Default: Month of/status only. --nop-only: NOPs plus financial snapshots, preserving months and cash. Default rolls back; --apply commits; --verify checks the mode's latest backup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, todayInManila } from '../lib/account-rules.ts';
import { repriceEntries } from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const serialized = value => JSON.parse(JSON.stringify(value));
const apply = process.argv.includes('--apply');
const verifying = process.argv.includes('--verify');
const nopOnly = process.argv.includes('--nop-only');
const planFile = process.argv.find(a => a.startsWith('--plan='))?.slice(7) ?? (nopOnly ? 'legacy-data/source-nop-review-20261019.json' : 'legacy-data/source-month-review-20261019.json');
const actor = nopOnly ? 'Source NOP correction' : 'Source Month of correction';
const prefix = nopOnly ? 'source-nop-repair-20261019-' : 'source-month-repair-20261019-';
const correctionId = id => `${nopOnly ? 'COR-NOP' : 'COR-MONTH'}-20261019-${id}`;
class Rollback extends Error {}
function sameExcept(actual,before,fields) {
  const omit = row => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  assert.deepEqual(omit(actual),omit(before));
}
async function verify(tx,snapshot) {
  const ids = snapshot.accounts.map(a => a.enrollment_id);
  const accounts = serialized(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id`);
  const rows = serialized(await tx`select * from collections where enrollment_id in ${tx(ids)} order by collection_id`);
  assert.equal(accounts.length,snapshot.accounts.length);
  assert.equal(rows.length,snapshot.collections.length);
  const proposed = new Map(snapshot.plan.cases.flatMap(c => c.proposed.map(p => [p.id,p])));
  const originalRows = new Map(snapshot.collections.map(p => [p.collection_id,p]));
  let changed = 0;
  for (const row of rows) {
    const before = originalRows.get(row.collection_id);
    assert.ok(before);
    sameExcept(row,before,nopOnly ? ['nop_from','nop_to','remittance_amount','remittance_breakdown','forfeited_incentive'] : ['month_from','month_to']);
    const expected = proposed.get(row.collection_id);
    assert.equal(row.month_from,expected?.monthFrom ?? before.month_from);
    assert.equal(row.month_to,expected?.monthTo ?? before.month_to);
    if (nopOnly) {
      assert.equal(row.nop_from,expected?.nopFrom ?? before.nop_from);
      assert.equal(row.nop_to,expected?.nopTo ?? before.nop_to);
      const price = snapshot.finance?.changes.find(c => c.id === row.collection_id);
      if (price) {
        assert.equal(Number(row.remittance_amount),price.after.remittance);
        assert.deepEqual(row.remittance_breakdown,price.after.breakdown);
        assert.equal(Number(row.forfeited_incentive),Number(price.after.forfeited));
      } else for (const field of ['remittance_amount','remittance_breakdown','forfeited_incentive']) assert.deepEqual(row[field],before[field]);
    }
    if (nopOnly ? row.nop_from !== before.nop_from || row.nop_to !== before.nop_to : row.month_from !== before.month_from || row.month_to !== before.month_to) changed++;
  }
  for (const row of accounts) {
    const before = snapshot.accounts.find(a => a.enrollment_id === row.enrollment_id);
    sameExcept(row,before,['account_status']);
    assert.equal(row.account_status,snapshot.plan.cases.find(c => c.account.id === row.enrollment_id).statusAfter);
  }
  const correctionIds = snapshot.plan.cases.map(c => correctionId(c.account.id));
  const records = await tx`select correction_id from record_corrections where correction_id in ${tx(correctionIds)}`;
  assert.equal(records.length,correctionIds.length);
  assert.equal(changed,snapshot.plan.summary.changedReceipts);
  return {accounts:accounts.length,changedReceipts:changed,...(nopOnly ? {coveredMonthsAndReceiptFieldsUnchanged:true,financeVerified:true} : {allOtherFieldsUnchanged:true})};
}
try {
  if (verifying) {
    const filename = fs.readdirSync('backups').filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort().at(-1);
    assert.ok(filename,'No applied repair backup');
    const snapshot = JSON.parse(fs.readFileSync(`backups/${filename}`,'utf8'));
    console.log(JSON.stringify(await db.begin('isolation level repeatable read read only',tx => verify(tx,snapshot))));
  } else {
    const plan = JSON.parse(fs.readFileSync(planFile,'utf8'));
    assert.ok(plan.cases.length > 0,'No reviewed cases');
    assert.equal(new Set(plan.cases.map(c => c.account.id)).size,plan.cases.length);
    await db.begin(async tx => {
      const ids = plan.cases.map(c => c.account.id);
      const accounts = serialized(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id for update`);
      const rows = serialized(await tx`select * from collections where enrollment_id in ${tx(ids)} order by collection_id for update`);
      assert.equal(accounts.length,ids.length);
      const prior = await tx`select record_id from record_corrections where record_id in ${tx([...ids,...rows.map(r => r.collection_id)])} and (${nopOnly} = false or module is distinct from 'Source Month of correction') limit 1`;
      assert.equal(prior.length,0,'A history was corrected since source review; stop');
      if (nopOnly) {
        const links = await tx`select remittance_id from remittance_collections where collection_id in ${tx(rows.map(r => r.collection_id))} limit 1`;
        assert.equal(links.length,0,'NOP-only sweep excludes receipts mapped to remittance slips');
      }
      const patches = [];
      for (const c of plan.cases) {
        const a = accounts.find(a => a.enrollment_id === c.account.id);
        assert.equal(a.member_id,c.account.memberId);
        assert.equal(a.program_id,c.account.programId);
        assert.equal(a.doi?.slice(0,10),c.account.doi);
        assert.equal(a.account_status,c.account.storedStatus);
        const history = rows.filter(r => r.enrollment_id === a.enrollment_id && r.status === 'Posted');
        assert.equal(history.length,c.receipts.length,'Posted receipt count changed');
        for (const p of c.receipts) {
          const row = history.find(r => r.collection_id === p.id);
          assert.ok(row,'Reviewed receipt missing');
          assert.equal(row.program_id,c.account.programId);
          assert.equal(row.or_number,p.orNumber);
          assert.equal(row.or_date?.slice(0,10),p.orDate);
          assert.equal(Number(row.amount_collected),p.amount);
          assert.equal(row.nop_from,p.nopFrom);
          assert.equal(row.nop_to,p.nopTo);
          assert.equal(row.month_from,p.monthFrom);
          assert.equal(row.month_to,p.monthTo);
          const next = c.proposed.find(r => r.id === p.id);
          if (nopOnly) {
            assert.equal(next.monthFrom,p.monthFrom);
            assert.equal(next.monthTo,p.monthTo);
            assert.equal(next.nopTo-next.nopFrom,p.nopTo-p.nopFrom);
          } else {
            assert.equal(next.nopFrom,p.nopFrom);
            assert.equal(next.nopTo,p.nopTo);
          }
          assert.equal(next.amount,p.amount);
          assert.equal(next.orDate,p.orDate);
          if (nopOnly ? next.nopFrom !== p.nopFrom || next.nopTo !== p.nopTo : next.monthFrom !== p.monthFrom || next.monthTo !== p.monthTo) patches.push({id:p.id,from:nopOnly ? next.nopFrom : next.monthFrom,to:nopOnly ? next.nopTo : next.monthTo});
        }
        assert.equal(accountState({...c.account,branch:'',mas:''},c.proposed,todayInManila()).status,c.statusAfter,'Status calculation changed');
      }
      assert.equal(patches.length,plan.summary.changedReceipts);
      const snapshot = {savedAt:new Date().toISOString(),plan,accounts,collections:rows};
      let backup;
      if (apply) {
        fs.mkdirSync('backups',{recursive:true});
        backup = `backups/${prefix}${Date.now()}.json`;
        fs.writeFileSync(backup,JSON.stringify(snapshot,null,2));
        console.log(`Saved ${backup}`);
      }
      await tx`select set_config('app.user_name',${actor},true)`;
      if (nopOnly) {
        await tx`update collections c set nop_from=v."from",nop_to=v."to" from jsonb_to_recordset(${tx.json(patches)}::jsonb) as v(id text,"from" int,"to" int) where c.collection_id=v.id`;
        snapshot.finance = await repriceEntries((query,params) => tx.unsafe(query,params),{collectionIds:patches.map(p => p.id)});
        assert.equal(snapshot.finance.slips.length,0);
        console.log(JSON.stringify({financialSnapshots:snapshot.finance.changes.length,incentiveChange:snapshot.finance.incentiveChange,remittanceSlipsChanged:0}));
        if (backup) fs.writeFileSync(backup,JSON.stringify(snapshot,null,2));
      } else await tx`update collections c set month_from=v."from",month_to=v."to" from jsonb_to_recordset(${tx.json(patches)}::jsonb) as v(id text,"from" text,"to" text) where c.collection_id=v.id`;
      const statuses = plan.cases.map(c => ({id:c.account.id,status:c.statusAfter}));
      await tx`update member_programs a set account_status=v.status from jsonb_to_recordset(${tx.json(statuses)}::jsonb) as v(id text,status text) where a.enrollment_id=v.id and a.account_status is distinct from v.status`;
      const stamp = new Date().toISOString();
      await tx`insert into record_corrections ${tx(plan.cases.map(c => ({correction_id:correctionId(c.account.id),module:actor,record_id:c.account.id,reason:nopOnly ? 'Owner requested similar NOP fixes. Source-covered months and later source NOPs confirm preserved DOI alignment. Correct NOP ranges only; preserve months, amounts, dates, program and DOI; recalculate financial snapshots without changing actual cash.' : 'Owner requested further Month of fixes. Complete original 2026 source history matches receipt identity, dates, amounts and month counts; restore source covered months, preserving NOPs/DOI/program/finance.',before_json:{account:c.account,receipts:c.receipts},after_json:{status:c.statusAfter,receipts:c.proposed,...(nopOnly ? {finance:snapshot.finance.changes.filter(p => c.receipts.some(r => r.id === p.id))} : {})},corrected_at:stamp,encoded_at:stamp,encoded_by_name:actor})))}`;
      console.log(JSON.stringify(await verify(tx,snapshot)));
      if (!apply) throw new Rollback();
      console.log('Applied.');
    });
  }
} catch(error) { if (error instanceof Rollback) console.log('Dry run rolled back.'); else throw error; }
finally { await db.end(); }
