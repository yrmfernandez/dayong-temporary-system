// Source-confirmed cross-member receipt reassignment. Rollback unless --apply.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, todayInManila } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const id='COL-LEG-F565251B04',from='ENR-LEG-8EE0C7DD4C',to='ENR-LEG-FB7244DEAC';
class DryRun extends Error {}
try {await sql.begin(async tx=>{
 if(process.argv.includes('--verify')) {
  const backup=JSON.parse(fs.readFileSync('backups/or12617-owner-apply-20261020.json','utf8'));
  const [current]=await tx`select * from collections where collection_id=${id}`;
  assert.equal(current.enrollment_id,to);assert.equal(current.member_number,'PH-80648675');assert.equal(current.member_id,'MEM-LEG-ADAA495D1E');
  const omitOwner=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['enrollment_id','member_number','member_id'].includes(k)));
  assert.deepEqual(JSON.parse(JSON.stringify(omitOwner(current))),omitOwner(backup.payment));
  const prior=backup.allPayments.find(p=>p.collection_id!==id);
  const [priorNow]=await tx`select * from collections where collection_id=${prior.collection_id}`;
  assert.deepEqual(JSON.parse(JSON.stringify(priorNow)),prior);
  assert.equal((await tx`select 1 from member_programs where enrollment_id=${from}`).length,0);
  const [remaining]=await tx`select count(*)::int as count,sum(amount_collected)::float8 as total from collections where member_number='PH-68134668'`;
  assert.equal(remaining.count,8);assert.equal(remaining.total,2700);
  const [target]=await tx`select account_status from member_programs where enrollment_id=${to}`;assert.equal(target.account_status,'60D');
  console.log('Verified correct owner, unchanged financial fields/date/amount/coverage and prior payment, removed empty wrong account, and Felisa retains eight receipts totaling PHP2,700.');
  return;
 }
 await tx`select set_config('app.user_name','Source-confirmed receipt ownership correction',true)`;
 const [payment]=await tx`select * from collections where collection_id=${id} for update`;
 const accounts=await tx`select mp.*,mp.doi::text as doi_text,p.base_pay::float8 as rate,p.pay_balance_total::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum from member_programs mp join programs p on p.program_id=mp.program_id where mp.enrollment_id in (${from},${to}) for update of mp`;
 const target=accounts.find(a=>a.enrollment_id===to);
 assert.equal(target?.member_number,'PH-80648675');
 assert.equal(target.program_id,'DP-0013');assert.equal(target.doi_text,'2023-02-01');
 if(payment.enrollment_id===to){assert.equal(payment.member_number,target.member_number);console.log('Already corrected.');return;}
 assert.equal(payment.enrollment_id,from);assert.equal(payment.member_number,'PH-68134668');
 assert.equal(payment.member_id,'MEM-LEG-67C6E6146C');assert.equal(payment.program_id,'DP-0013');
 assert.equal(payment.or_number,'12617 C');assert.equal(Number(payment.amount_collected),700);
 assert.equal(payment.or_date.toISOString().slice(0,10),'2026-08-18');
 assert.equal(payment.nop_from,42);assert.equal(payment.nop_to,43);assert.equal(payment.month_from,'2026-07');assert.equal(payment.month_to,'2026-08');
 assert.equal(payment.status,'Posted');assert.equal(payment.linked_remittance_id,null);
 const links=await tx`select * from remittance_collections where collection_id=${id}`;assert.equal(links.length,0);
 const allPayments=await tx`select * from collections where enrollment_id in (${from},${to}) for update`;
 assert.equal(allPayments.length,2);assert.equal(allPayments.filter(p=>p.enrollment_id===from).length,1);
 const prior=allPayments.find(p=>p.enrollment_id===to);
 assert.equal(prior.collection_id,'COL-LEG-87F07D2D00');assert.equal(prior.nop_from,39);assert.equal(prior.nop_to,41);
 assert.equal(prior.month_from,'2026-04');assert.equal(prior.month_to,'2026-06');assert.equal(Number(prior.amount_collected),1050);
 const sourceRows=JSON.parse(fs.readFileSync('legacy-data/or12617b-source-20261020.json','utf8'));
 const source=sourceRows.find(s=>s.source==='M3-COLL'&&s.row===14208);
 assert.equal(source?.fields['PH/MEMBER'],'Dequiña, Dominador');assert.equal(source.fields['OR NUMBER'],payment.or_number);
 fs.mkdirSync('backups',{recursive:true});
 fs.writeFileSync(`backups/or12617-owner-${apply?'apply':'preview'}-20261020.json`,JSON.stringify({payment,accounts,allPayments,source},null,2));
 await tx`update collections set member_id=${target.member_id},member_number=${target.member_number},enrollment_id=${to} where collection_id=${id}`;
 // Program, NOP, amount, branch and collector are unchanged: preserve all financial snapshots.
 const finance={preserved:true,incentiveChange:0,linkedRemittances:0};
 const targetPayments=await tx`select collection_id,or_number,or_date::text as date,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to from collections where enrollment_id=${to} and status='Posted' order by or_date,collection_id`;
 const state=accountState({id:to,memberId:target.member_id,memberNumber:target.member_number,programId:target.program_id,doi:target.doi_text,branch:target.branch,mas:target.mas,basePay:target.rate,payBalanceTotal:target.total,storedStatus:target.account_status,flexible:target.flexible,maxMonthlyPayment:target.maximum},targetPayments.map(p=>({id:p.collection_id,enrollmentId:to,orDate:p.date,orNumber:p.or_number,amount:p.amount,nopFrom:p.nop_from,nopTo:p.nop_to,monthFrom:p.month_from,monthTo:p.month_to,dateRemitted:'',mas:target.mas})),todayInManila());
 await tx`update member_programs set account_status=${state.status} where enrollment_id=${to}`;
 // The erroneous enrollment contained only this receipt; refuse to remove it if other history points to it.
 const references=await tx`select (select count(*) from sales where member_number='PH-68134668' and program_id='DP-0013')::int as sales,(select count(*) from member_transfers where enrollment_id=${from})::int as transfers,(select count(*) from collections where enrollment_id=${from})::int as payments`;
 assert.deepEqual({...references[0]},{sales:0,transfers:0,payments:0});
 await tx`delete from member_programs where enrollment_id=${from}`;
 const [after]=await tx`select collection_id,member_id,member_number,enrollment_id,or_number,or_date::text,amount_collected::float8,nop_from,nop_to,month_from,month_to from collections where collection_id=${id}`;
 const stamp=new Date().toISOString();
 await tx`insert into record_corrections ${tx({correction_id:'COR-OR12617-OWNER-20261020',module:'Collection ownership',record_id:id,reason:'Owner identified OR12617 as not belonging to PH-68134668. Original M3-COLL row14208 names Dequiña, Dominador, D-350, CALINAN; OR12617 C dated August18,2026 PHP700 July-August NOP42-43. Reassign existing receipt to PH-80648675 and remove empty erroneous D-350 enrollment from Felisa Dorado. Preserve receipt date, amount, program and coverage.',before_json:{payment,accounts},after_json:{payment:after,removedEmptyAccount:from,status:state.status,finance},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Source-confirmed receipt ownership correction'})}`;
 console.log(JSON.stringify({payment:after,removedEmptyAccount:from,targetStatus:state.status,total:targetPayments.reduce((n,p)=>n+p.amount,0),finance},null,2));
 if(!apply)throw new DryRun();
 console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
