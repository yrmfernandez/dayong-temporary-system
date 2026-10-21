import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey} from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
try{
 const p=JSON.parse(fs.readFileSync('legacy-data/receipt-12665B-import-plan-private.json','utf8'));
 const rows=await db`select * from collections where collection_id=${p.source.originalRowId??p.source.id} or regexp_replace(upper(or_number),'[^A-Z0-9]','','g')='12665B'`;
 const members=rows.length?await db`select member_id,member_number from members where member_id in ${db(rows.map(r=>r.member_id))}`:[];
 fs.writeFileSync('legacy-data/receipt-12665B-link-private.json',JSON.stringify({rows,members}));
 const counts=await db`select count(*)::int as count from collections where member_number='PH-77690372'`;
 const current=await db`select * from collections where member_number='PH-77690372'`;
 fs.writeFileSync('legacy-data/receipt-12665B-current-nine-private.json',JSON.stringify(current));
 console.log(JSON.stringify({ownerMatchCounts:p.ownerExpected.map(e=>({matches:current.filter(r=>receiptKey(r.or_number)===e.key).length,exactDateAmountCoverage:current.filter(r=>receiptKey(r.or_number)===e.key&&r.or_date.toISOString().slice(0,10)===e.orDate&&Number(r.amount_collected)===e.amount&&r.month_from===e.monthFrom&&r.month_to===e.monthTo&&r.nop_from===e.nopFrom&&r.nop_to===e.nopTo).length})),unmatchedReceipts:current.filter(r=>!p.ownerExpected.some(e=>receiptKey(r.or_number)===e.key)).length}));
 console.log(JSON.stringify({memberReceipts:counts[0].count,matches:rows.length,checks:rows.map(r=>({sameReceipt:receiptKey(r.or_number)==='12665B',sameOrDate:r.or_date.toISOString().slice(0,10)==='2026-08-20',sameAmount:Number(r.amount_collected)===350,memberNumberMatches:r.member_number==='PH-77690372',memberIdMatches:r.member_id===p.account.member_id,enrollmentMatches:r.enrollment_id===p.account.enrollment_id,programMatches:r.program_id===p.account.program_id,hasRemittance:!!r.linked_remittance_id,posted:r.status==='Posted',orKeyMatches:receiptKey(r.or_number)===r.or_key,memberNumberResolves:members.some(m=>m.member_id===r.member_id&&m.member_number===r.member_number)}))}));
}finally{await db.end();}
