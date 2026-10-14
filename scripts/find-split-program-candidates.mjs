/** Read-only search for unresolved member histories split across related programs. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const project=/postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL??'')?.[1]??'unknown';
try{await sql.begin('isolation level repeatable read read only',async tx=>{
 const programs=await tx`select program_id,program_name,base_pay::float8 as rate from programs`;
 const families=[['DP-0017','DP-0018'],['DP-0022','DP-0023'],['DP-0010','DP-0013','DP-0009'],['DP-0065','DP-0067']];
 const ids=[...new Set(families.flat())];
 const accounts=await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,a.doi::text,a.branch from member_programs a join members m on m.member_id=a.member_id where a.program_id in ${tx(ids)}`;
 const payments=await tx`select c.collection_id,c.member_id,c.enrollment_id,c.program_id,c.or_number,c.or_date::text,c.amount_collected::float8 as amount,c.month_from,c.month_to,c.nop_from,c.nop_to from collections c where c.program_id in ${tx(ids)} and c.status='Posted'`;
 const grouped=new Map();for(const a of accounts){const list=grouped.get(a.member_id)??[];list.push(a);grouped.set(a.member_id,list);}
 const byAccount=new Map();for(const p of payments){const list=byAccount.get(p.enrollment_id)??[];list.push(p);byAccount.set(p.enrollment_id,list);}
 const candidates=[];const month=s=>/^\d{4}-\d{2}$/.test(s??'')?Number(s.slice(0,4))*12+Number(s.slice(5,7))-1:null;
 for(const list of grouped.values())for(const family of families){
  const set=list.filter(a=>family.includes(a.program_id));if(set.length<2)continue;
  const history=set.flatMap(a=>byAccount.get(a.enrollment_id)??[]).sort((a,b)=>(a.or_date??'').localeCompare(b.or_date??'')||a.collection_id.localeCompare(b.collection_id));
  const withPayments=set.filter(a=>(byAccount.get(a.enrollment_id)??[]).length);if(withPayments.length<2)continue;
  const switches=history.slice(1).filter((p,i)=>p.enrollment_id!==history[i].enrollment_id).length;
  let consecutiveNop=true;for(let i=1;i<history.length;i++)if(history[i].nop_from!==history[i-1].nop_to+1)consecutiveNop=false;
  const months=new Set();let overlap=false;for(const p of history){const from=month(p.month_from),to=month(p.month_to);if(from===null||to===null||to-from>1200){overlap=true;continue;}for(let k=from;k<=to;k++){if(months.has(k))overlap=true;months.add(k);}}
  const sameDoi=new Set(set.map(a=>a.doi)).size===1;
  const rates=new Set(set.map(a=>programs.find(p=>p.program_id===a.program_id)?.rate));
  const singleInstallments=history.every(p=>p.nop_to===p.nop_from&&p.amount===programs.find(pr=>pr.program_id===p.program_id)?.rate);
  const receiptMonths=history.map(p=>p.or_date?.slice(0,7));
  const onePerReceiptMonth=new Set(receiptMonths).size===history.length;
  const receiptMonthSteps=receiptMonths.every((m,i)=>i===0||month(m)===month(receiptMonths[i-1])+1);
  const parallelDates=history.some((p,i)=>history.slice(0,i).some(q=>q.or_date===p.or_date&&q.enrollment_id!==p.enrollment_id));
  const strong=sameDoi&&rates.size===1&&singleInstallments&&onePerReceiptMonth&&receiptMonthSteps&&switches>=2;
  const contiguous=sameDoi&&rates.size===1&&consecutiveNop&&!overlap;
  const rank=strong?'Strong split-history pattern':contiguous?'Continuous sequence across accounts':'Needs source review';
  candidates.push({member:list[0].member_number,family:family.map(id=>programs.find(p=>p.program_id===id)?.program_name??id).join(' / '),rank,sameDoi,receiptCount:history.length,programSwitches:switches,overlappingStoredMonths:overlap,parallelReceiptDates:parallelDates,consecutiveNop,accounts:set.map(a=>({...a,program:programs.find(p=>p.program_id===a.program_id)?.program_name,payments:(byAccount.get(a.enrollment_id)??[]).length})),receipts:history});
 }
 candidates.sort((a,b)=>({ 'Strong split-history pattern':0,'Continuous sequence across accounts':1,'Needs source review':2}[a.rank]-{'Strong split-history pattern':0,'Continuous sequence across accounts':1,'Needs source review':2}[b.rank])||a.family.localeCompare(b.family)||a.member.localeCompare(b.member));
 const summary={total:candidates.length,byRank:{},byFamily:{}};for(const c of candidates){summary.byRank[c.rank]=(summary.byRank[c.rank]??0)+1;summary.byFamily[c.family]=(summary.byFamily[c.family]??0)+1;}
 const base=`legacy-data/unresolved-split-programs-2026-10-14-${project}`;
 fs.writeFileSync(base+'.json',JSON.stringify({generatedAt:new Date().toISOString(),project,summary,candidates},null,2));
 const lines=['# Unresolved split-program candidates','',`Production project ${project}; snapshot ${new Date().toISOString()}. Read-only: no changes.`,'','Scope: members with posted payments on at least two programs in the DPB-420/D-420, D-460 (59B)/D-460, DPB-350/D-350/D-350 (5Y), and D-300/D-300 (Bracketing) families. Programs can legitimately differ in incentive rules; these are review candidates, not automatic merge instructions.','', 'Strong pattern: identical DOI/rate, one exact installment per receipt, one receipt per consecutive calendar month, and at least two switches between accounts. Continuous sequence: same DOI/rate, consecutive NOPs, no stored-month overlap. Other candidates need closer source review.','', '| Member | Programs | Pattern | Receipts | Switches | Same DOI | Stored-month overlap |','| --- | --- | --- | ---: | ---: | --- | --- |',...candidates.map(c=>`| ${c.member} | ${c.family} | ${c.rank} | ${c.receiptCount} | ${c.programSwitches} | ${c.sameDoi} | ${c.overlappingStoredMonths} |`)];
 for(const c of candidates.filter(c=>c.rank!=='Needs source review')){lines.push('',`## ${c.member}`,'',c.family,'','| OR | Date | Amount | Program | Stored months | NOP |','| --- | --- | ---: | --- | --- | --- |',...c.receipts.map(p=>`| ${p.or_number} | ${p.or_date} | ${p.amount} | ${programs.find(pr=>pr.program_id===p.program_id)?.program_name} | ${p.month_from}–${p.month_to} | ${p.nop_from}–${p.nop_to} |`));}
 fs.writeFileSync(base+'.md',lines.join('\n'));
 console.log(JSON.stringify({summary,priority:candidates.filter(c=>c.rank!=='Needs source review').map(c=>({member:c.member,family:c.family,rank:c.rank,receipts:c.receiptCount})),otherSample:candidates.filter(c=>c.rank==='Needs source review').slice(0,8).map(c=>({member:c.member,family:c.family,receipts:c.receiptCount})),report:base+'.md'},null,2));
});}finally{await sql.end();}
