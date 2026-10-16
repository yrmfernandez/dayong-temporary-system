/** Rank the fresh read-only split-history audit using account, coverage and application evidence. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
const source = JSON.parse(fs.readFileSync(`legacy-data/program-receipt-review-${date}.json`,'utf8'));
if (Date.now()-Date.parse(source.generatedAt)>15*60*1000) throw new Error('Refresh find-misfiled-program-receipts.mjs before this review.');
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const key=x=>String(x??'').trim().toUpperCase().replace(/\s+/g,' ');
const mi=s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(s??'') ? Number(s.slice(0,4))*12+Number(s.slice(5,7))-1 : null;
try { await db.begin('isolation level repeatable read read only',async tx=>{
  const ids=[...new Set(source.sequences.flatMap(s=>s.accounts))];
  if (!ids.length) {console.log('No same-pay split candidates.');return;}
  const rows=await tx`select a.enrollment_id,a.member_number,a.program_id,a.doi::text as doi,a.branch,a.mas,a.mas_employee_id,p.program_name,p.base_pay::float8 as rate from member_programs a join programs p on p.program_id=a.program_id where a.enrollment_id in ${tx(ids)}`;
  const byId=new Map(rows.map(r=>[r.enrollment_id,r]));
  const payments=await tx`select collection_id,enrollment_id,program_id,or_number,or_date::text as or_date,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to from collections where enrollment_id in ${tx(ids)} and status='Posted'`;
  const numbers=[...new Set(rows.map(r=>r.member_number))];
  const sales=await tx`select member_number,program_id,application_key from sales where member_number in ${tx(numbers)}`;
  const candidates=[];
  for(const s of source.sequences){
    const accounts=s.accounts.map(id=>byId.get(id));if(accounts.some(a=>!a))continue;
    const [a,b]=accounts;
    const history=payments.filter(p=>s.accounts.includes(p.enrollment_id)).sort((a,b)=>a.or_date.localeCompare(b.or_date)||a.collection_id.localeCompare(b.collection_id));
    const sameDoi=Boolean(a.doi&&a.doi===b.doi),sameRate=a.rate===b.rate;
    const sameBranch=Boolean(key(a.branch)&&key(a.branch)===key(b.branch));
    const sameMas=Boolean(a.mas_employee_id&&a.mas_employee_id===b.mas_employee_id)||Boolean(key(a.mas)&&key(a.mas)===key(b.mas));
    const apps=accounts.map(a=>new Set(sales.filter(x=>x.member_number===a.member_number&&x.program_id===a.program_id).map(x=>x.application_key).filter(Boolean)));
    const distinctApplications=apps.every(x=>x.size>0)&&![...apps[0]].some(x=>apps[1].has(x));
    const months=new Set();let overlap=false,invalidCoverage=false;
    for(const r of history){const from=mi(r.month_from),to=mi(r.month_to);if(from===null||to===null||to<from||to-from>1200){invalidCoverage=true;continue;}for(let k=from;k<=to;k++){if(months.has(k))overlap=true;months.add(k);}}
    const consecutive=history.every((r,i)=>i===0||r.nop_from===history[i-1].nop_to+1);
    const exact=history.every(r=>r.nop_from>0&&r.nop_to>=r.nop_from&&Math.round(r.amount*100)===Math.round(a.rate*100)*(r.nop_to-r.nop_from+1));
    const uniqueDates=new Set(history.map(r=>r.or_date)).size===history.length;
    const strong=sameRate&&sameDoi&&sameBranch&&sameMas&&consecutive&&exact&&uniqueDates&&!overlap&&!invalidCoverage&&!distinctApplications&&history.length>=3;
    const counts=accounts.map(a=>({...a,receiptCount:history.filter(r=>r.enrollment_id===a.enrollment_id).length})).sort((a,b)=>b.receiptCount-a.receiptCount);
    candidates.push({member:s.member,basePay:a.rate,rank:strong?'Likely one payment history':'Needs closer review',programs:counts.map(a=>({program:a.program_name,id:a.program_id,account:a.enrollment_id,receipts:a.receiptCount})),majorityProgram:counts[0].receiptCount>counts[1].receiptCount?counts[0].program_name:null,sameDoi,sameBranch,sameMas,consecutiveNop:consecutive,overlappingStoredMonths:overlap,distinctApplications,receipts:history.map(r=>({receipt:r.or_number,date:r.or_date,amount:r.amount,program:byId.get(r.enrollment_id).program_name,nop:[r.nop_from,r.nop_to],months:[r.month_from,r.month_to]}))});
  }
  candidates.sort((a,b)=>(a.rank.startsWith('Likely')?0:1)-(b.rank.startsWith('Likely')?0:1)||b.receipts.length-a.receipts.length||a.member.localeCompare(b.member));
  const priority=candidates.filter(c=>c.rank.startsWith('Likely'));
  const summary={reviewed:candidates.length,likelyOneHistory:priority.length,needsCloserReview:candidates.length-priority.length};
  const base=`legacy-data/same-base-pay-candidates-${date}`;
  fs.writeFileSync(base+'.json',JSON.stringify({generatedAt:new Date().toISOString(),summary,candidates},null,2));
  const lines=['# Same-base-pay accounts that may be one enrollment','',`Read-only production review, ${date}. No database records changed.`, '', 'Priority requires matching base pay, DOI, branch and MAS; exact installments; consecutive NOPs in receipt-date order; no duplicate receipt dates or overlapping stored months; at least three receipts; and no evidence of distinct application numbers on both programs. The program holding more receipts is only a review lead, not proof of the correct incentive program. Missing New Sale records do not prove one enrollment.','',`Reviewed ${summary.reviewed} pairs: ${summary.likelyOneHistory} likely one history; ${summary.needsCloserReview} need closer review.`,'','| Member | Base pay | Programs (receipt counts) | Priority |','| --- | ---: | --- | --- |',...candidates.map(c=>`| ${c.member} | ${c.basePay} | ${c.programs.map(p=>`${p.program} (${p.receipts})`).join(' / ')} | ${c.rank} |`), ...priority.flatMap(c=>['',`## ${c.member}`,'',`${c.programs.map(p=>`${p.program}: ${p.receipts} receipts`).join('; ')}. Majority program: ${c.majorityProgram??'tied'}.`,'','| Receipt | Date | Amount | Program | NOP |','| --- | --- | ---: | --- | --- |',...c.receipts.map(r=>`| ${r.receipt} | ${r.date} | ${r.amount} | ${r.program} | ${r.nop.join('–')} |`)])];
  fs.writeFileSync(base+'.md',lines.join('\n'));
  console.log(JSON.stringify({summary,first:priority.slice(0,15).map(c=>({member:c.member,basePay:c.basePay,programs:c.programs,minorityReceipts:c.receipts.filter(r=>r.program!==c.majorityProgram).map(r=>r.receipt)})),report:base+'.md'},null,2));
}); } finally {await db.end();}
