import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { repriceEntries } from '../lib/entry-finance.mjs';

test('corrected programs reprice collections, sales, forfeitures and slip expectations atomically and idempotently', async () => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`
      create table branches (branch_id text, branch_name_code text);
      create table programs (program_id text, base_pay numeric, flexible boolean default false, max_monthly_payment numeric, registration_fee_required boolean default false, new_sale_incentive_type text, new_sale_incentive_amount numeric);
      create table program_incentives (incentive_id text, program_id text, role text, from_month int, to_month int, incentive_type text, mark_up numeric, incentive_amount numeric, branch_id text, non_commissionable boolean default false);
      create table collections (collection_id text, program_id text, branch text, branch_id text, amount_collected numeric, nop_from int, nop_to int, collected_by_role text, accountable_role text, reactivation boolean default false, remittance_amount numeric, remittance_breakdown jsonb, forfeited_incentive numeric, status text default 'Posted');
      create table sales (sale_id text, program_id text, branch text, branch_id text, amount_paid numeric, remittance_amount numeric, mas_incentive numeric, forfeited_incentive numeric);
      create table remittance_collections (remittance_id text, collection_id text, amount numeric);
      create table remittances (remittance_id text, gross_collection numeric, total_remittance numeric, difference numeric, fidelity numeric);
      insert into programs (program_id,base_pay) values ('P',350), ('NO-TIERS',350);
      insert into branches values ('B','Branch');
      insert into program_incentives values ('M','P','MAS',1,3,'fixed',0,100,null,false), ('MB','P','MAS',1,3,'fixed',0,150,'B',false), ('ML','P','MAS',4,999,'fixed',0,50,null,false), ('MBL','P','MAS',4,999,'fixed',0,50,'B',false), ('C','P','Collector',1,999,'fixed',0,30,null,false);
      insert into collections (collection_id,program_id,branch,amount_collected,nop_from,nop_to,collected_by_role,remittance_amount,forfeited_incentive) values
        ('C1','P','Branch',700,3,4,'MAS',700,0), ('C2','P','Branch',350,2,2,'MAS',350,10), ('DTO','P','Branch',350,2,2,'DTO',1,0), ('ORC','P','Branch',350,2,2,'Collector',350,0), ('RE','P','Branch',350,2,2,'MAS',350,0);
      update collections set remittance_breakdown='[{"orc":true}]' where collection_id='ORC';
      update collections set reactivation=true where collection_id='RE';
      insert into sales values ('S1','P','Branch',null,350,350,0,0);
      insert into remittances values ('R',1070,1070,0,20);
      insert into remittance_collections values ('R','C1',700), ('R','S1',350);
    `);
    const input = { collectionIds: ['C1','C2','DTO','ORC','RE'], saleIds: ['S1'] };
    const result = await repriceEntries(query, input);
    assert.equal(result.changes.length, 6);
    assert.deepEqual(await query('select collection_id, remittance_amount::float8 as share, forfeited_incentive::float8 as forfeited from collections order by collection_id'), [
      {collection_id:'C1',share:500,forfeited:0}, {collection_id:'C2',share:350,forfeited:150}, {collection_id:'DTO',share:350,forfeited:0}, {collection_id:'ORC',share:275,forfeited:0}, {collection_id:'RE',share:315,forfeited:0}
    ]);
    assert.deepEqual(await query('select remittance_amount::float8 as share, mas_incentive::float8 as incentive from sales'), [{share:200,incentive:150}]);
    assert.deepEqual(await query('select gross_collection::float8 as expected, total_remittance::float8 as actual, difference::float8 as difference, fidelity::float8 as fidelity from remittances'), [{expected:720,actual:1070,difference:350,fidelity:20}]);
    assert.equal((await repriceEntries(query, input)).changes.length, 0);
    await db.exec("update collections set remittance_amount=1 where collection_id='C1'; insert into collections (collection_id,program_id,amount_collected,nop_from,nop_to,collected_by_role) values ('BAD','NO-TIERS',350,2,2,'MAS')");
    await assert.rejects(repriceEntries(query, {collectionIds:['C1','BAD']}), /exactly one MAS incentive tier/);
    assert.equal((await query("select remittance_amount::float8 as share from collections where collection_id='C1'"))[0].share, 1, 'no partial financial writes when any tier is missing');
  } finally { await db.close(); }
});
