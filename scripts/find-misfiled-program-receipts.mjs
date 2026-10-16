/** Read-only production audit. IDs and receipt/account metadata only; no names or contact details. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL, {max:1, connect_timeout:15, onnotice:()=>{}});
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila'}).format(new Date());
const cents = n => Math.round(Number(n) * 100);
const month = s => /^\d{4}-\d{2}$/.test(s ?? '') ? Number(s.slice(0,4))*12+Number(s.slice(5,7))-1 : null;
try { await db.begin('isolation level repeatable read read only', async tx => {
  const programs = await tx`select program_id, program_name, base_pay::float8 as rate, flexible, max_monthly_payment::float8 as maximum from programs`;
  const programById = new Map(programs.map(p=>[p.program_id,p]));
  const accounts = await tx`select enrollment_id, member_id, member_number, program_id, doi::text as doi from member_programs`;
  const receipts = await tx`select collection_id, enrollment_id, member_id, program_id, or_number, or_date::text as or_date, amount_collected::float8 as amount, nop_from, nop_to, month_from, month_to from collections where status='Posted'`;
  const byMember = new Map(), byAccount = new Map();
  for (const a of accounts) { const list=byMember.get(a.member_id)??[]; list.push(a); byMember.set(a.member_id,list); }
  for (const r of receipts) { const list=byAccount.get(r.enrollment_id)??[]; list.push(r); byAccount.set(r.enrollment_id,list); }
  const accountById = new Map(accounts.map(a=>[a.enrollment_id,a]));
  const mismatches=[], sequences=[], disagreements=[];
  for (const r of receipts) {
    const a=accountById.get(r.enrollment_id), p=programById.get(r.program_id);
    if (!a || !p) continue;
    if (r.program_id!==a.program_id) disagreements.push({receipt:r.or_number,id:r.collection_id,account:a.enrollment_id,receiptProgram:r.program_id,accountProgram:a.program_id});
    const span=r.nop_to-r.nop_from+1;
    if (p.flexible || !p.rate || !r.nop_from || span<1 || span>1200 || cents(r.amount)===cents(p.rate)*span) continue;
    const alternatives=(byMember.get(a.member_id)??[]).filter(other=> {
      const target=programById.get(other.program_id);
      return other.enrollment_id!==a.enrollment_id && target && !target.flexible && target.rate>0 && cents(r.amount)===cents(target.rate)*span;
    });
    if (!alternatives.length) continue;
    const sameDoi=alternatives.filter(other=>a.doi && other.doi===a.doi && (byAccount.get(other.enrollment_id)??[]).length>0);
    const strong=sameDoi.length===1 && alternatives.length===1 && cents(r.amount)<cents(p.rate)*span;
    mismatches.push({member:a.member_number,receipt:r.or_number,id:r.collection_id,date:r.or_date,amount:r.amount,nop:[r.nop_from,r.nop_to],current:p.program_name,currentAccount:a.enrollment_id,currentExpected:p.rate*span,rank:strong?'Higher priority':'Review amount and program',alternatives:alternatives.map(other=>({program:programById.get(other.program_id).program_name,programId:other.program_id,account:other.enrollment_id,sameDoi:other.doi===a.doi,receipts:(byAccount.get(other.enrollment_id)??[]).length})),reason:cents(r.amount)<cents(p.rate)*span?'Below current installments; exactly matches another account':'Exceeds current installments; exactly matches another account (could be valid excess)'});
  }
  for (const list of byMember.values()) for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++) {
    const a=list[i],b=list[j],pa=programById.get(a.program_id),pb=programById.get(b.program_id);
    if (!a.doi || a.doi!==b.doi || a.program_id===b.program_id || !pa?.rate || pa.flexible || pb?.flexible || pa.rate!==pb?.rate) continue;
    const ra=byAccount.get(a.enrollment_id)??[], rb=byAccount.get(b.enrollment_id)??[];
    if (!ra.length || !rb.length) continue;
    const history=[...ra,...rb].sort((x,y)=>(x.or_date??'').localeCompare(y.or_date??'')||x.collection_id.localeCompare(y.collection_id));
    const exact=history.every(r=>r.nop_from>0 && r.nop_to>=r.nop_from && cents(r.amount)===cents(pa.rate)*(r.nop_to-r.nop_from+1));
    if (!exact) continue;
    const sequential=history.every((r,k)=>k===0||r.nop_from===history[k-1].nop_to+1);
    const switches=history.slice(1).filter((r,k)=>r.enrollment_id!==history[k].enrollment_id).length;
    const monthly=history.length>=3 && history.every((r,k)=>r.nop_from===r.nop_to && (k===0 || (month(r.or_date?.slice(0,7))!==null && month(r.or_date?.slice(0,7))===month(history[k-1].or_date?.slice(0,7))+1)));
    if (!sequential && !(monthly&&switches>=2)) continue;
    sequences.push({member:a.member_number,programs:[pa.program_name,pb.program_name],accounts:[a.enrollment_id,b.enrollment_id],reason:sequential?'Consecutive NOPs across accounts':'Alternating accounts in consecutive receipt months',receipts:history.map(r=>({receipt:r.or_number,date:r.or_date,amount:r.amount,program:programById.get(r.program_id)?.program_name,nop:[r.nop_from,r.nop_to]}))});
  }
  mismatches.sort((a,b)=>(a.rank==='Higher priority'?0:1)-(b.rank==='Higher priority'?0:1)||a.member.localeCompare(b.member)||a.date.localeCompare(b.date));
  const summary={accountsScanned:accounts.length,postedReceiptsScanned:receipts.length,amountCandidates:mismatches.length,amountCandidateMembers:new Set(mismatches.map(r=>r.member)).size,higherPriority:mismatches.filter(r=>r.rank==='Higher priority').length,splitSequences:sequences.length,programDisagreements:disagreements.length};
  const base=`legacy-data/program-receipt-review-${today}`;
  fs.writeFileSync(base+'.json',JSON.stringify({generatedAt:new Date().toISOString(),summary,mismatches,sequences,disagreements},null,2));
  const lines=['# Receipts requiring program review','',`Read-only production scan on ${today}. No database changes. No member names or contact data read.`, '', 'Amounts can legitimately exceed the monthly rate, and members can hold different programs. These patterns require owner confirmation; they do not prove a receipt is misfiled. Higher priority means the payment is below its current recorded installments but exactly matches one other existing account with the same DOI and payment history.','', '```json',JSON.stringify(summary,null,2),'```','', '| Member | Receipt | Amount | Current program | Current installments | Possible program(s) | Priority |','| --- | --- | ---: | --- | ---: | --- | --- |',...mismatches.map(r=>`| ${r.member} | ${r.receipt} | ${r.amount} | ${r.current} | ${r.currentExpected} | ${r.alternatives.map(a=>a.program).join(' / ')} | ${r.rank} |`),'','## Split sequences','',...sequences.flatMap(s=>[`### ${s.member}: ${s.programs.join(' / ')}`,'',s.reason,'','| Receipt | Date | Amount | Program | NOP |','| --- | --- | ---: | --- | --- |',...s.receipts.map(r=>`| ${r.receipt} | ${r.date} | ${r.amount} | ${r.program} | ${r.nop.join('–')} |`),''])];
  fs.writeFileSync(base+'.md',lines.join('\n'));
  console.log(JSON.stringify({summary,firstCandidates:mismatches.slice(0,15),splitSequences:sequences.slice(0,10),report:base+'.md'},null,2));
}); } finally { await db.end(); }
