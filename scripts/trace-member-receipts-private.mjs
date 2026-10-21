// Trace owner-specified receipt links; no member/source rows printed.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey,programKey} from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member=process.argv[2],keys=process.argv.slice(3);
if(!/^PH-\d{8}$/.test(member??'')||!keys.length)throw new Error('Pass member and receipts.');
const canon=v=>receiptKey(v).replace(/^0+(?=\d)/,'');
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
async function main(){
 const index=JSON.parse(fs.readFileSync('legacy-data/other-program-source-index-20261021.json','utf8'));
 const target=await db`select a.*,a.doi::text as day,p.program_code,p.program_name from member_programs a join programs p using(program_id) where a.member_number=${member}`;
 const rows=(await db`select *,or_date::text as day from collections where regexp_replace(or_key,'^0+','') like any(${db.array(keys.map(key=>canon(key)+'%'))}::text[])`).filter(r=>keys.some(key=>canon(r.or_number)===canon(key)));
 const allMemberIds=[...new Set(rows.map(r=>r.member_id))];
 const otherAccounts=allMemberIds.length?await db`select *,doi::text as day from member_programs where member_id in ${db(allMemberIds)}`:[];
 const report={member,target,rows,otherAccounts,sources:keys.map(key=>({key,sources:Object.entries(index.collections).filter(([,s])=>canon(s.or)===canon(key)).map(([id,s])=>({id,...s}))}))};
 fs.writeFileSync(`legacy-data/member-receipt-trace-${member}-private.json`,JSON.stringify(report));
 console.log(JSON.stringify({targetAccounts:target.length,receiptChecks:report.sources.map(({key,sources})=>{
  const found=rows.filter(r=>canon(r.or_number)===canon(key));
  return{existing:found.length,onRequestedMember:found.filter(r=>r.member_number===member).length,onOtherMembers:found.filter(r=>r.member_number!==member).length,
   sourceMatches:sources.length,distinctSourceIdentities:new Set(sources.map(s=>JSON.stringify([s.date,s.amount,s.program,s.coverage]))).size,
   matchingSourceIdsAlreadyImported:sources.filter(s=>rows.some(r=>r.collection_id===s.id)).length,
   existingMatchesTargetProgram:found.filter(r=>target.some(t=>t.program_id===r.program_id)).length,
   existingMatchesTargetBranch:found.filter(r=>target.some(t=>String(t.branch).trim().toUpperCase()===String(r.branch).trim().toUpperCase())).length,
   linkedRemittances:found.filter(r=>r.linked_remittance_id).length,
   sourceMatchesTargetProgram:sources.filter(s=>target.some(t=>[programKey(t.program_code),programKey(t.program_name)].includes(s.program))).length};
 })}));
}
main().catch(e=>{fs.writeFileSync('backups/member-receipt-trace-error-private.json',JSON.stringify({message:e.message,code:e.code}));console.error('Trace stopped; diagnostic saved privately.');process.exitCode=1;}).finally(async()=>{await db.end();});
