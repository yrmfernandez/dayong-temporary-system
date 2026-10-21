// Prepare one source-backed receipt import; print aggregate checks only.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {createHash} from 'node:crypto';
import { loadLegacySources } from './legacy-sources.mjs';
import { sourceDay, sourceCoverage, receiptKey, programKey, confirmedSequence } from './source-history-rules.mjs';
import { accountState, forfeitMonthsFor, todayInManila,monthIndex,saleNops } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const key = String(process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g,'');
const confirmedMember = process.argv.find(arg=>arg.startsWith('--member='))?.slice(9);
if(confirmedMember&&!/^PH-\d{8}$/.test(confirmedMember))throw new Error('Invalid member number.');
if (!/^\d+[A-Z]+$/.test(key)) throw new Error('Pass receipt number and suffix.');
const canon = (v) => receiptKey(v).replace(/^0+(?=\d)/,'');
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const words = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/[A-Z0-9]+/g)?.sort().join('|') ?? '';
let db;
async function main() {
  const location = JSON.parse(fs.readFileSync(`legacy-data/receipt-${key}-location-private.json`,'utf8'));
  if (location.collections.length || location.sales.length || location.audits.length || location.sourceCollections.length !== 1) throw new Error('SOURCE_NOT_UNIQUE_OR_ALREADY_USED');
  const match = location.sourceCollections[0];
  let sourceRow = process.argv.includes('--cached') ? JSON.parse(fs.readFileSync(`legacy-data/receipt-${key}-import-plan-private.json`,'utf8')).source : undefined;
  const loadedSources = (!sourceRow || process.argv.includes('--trace-source')) ? await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']) : [];
  for (const source of loadedSources) for (const tab of source.tabs) {
    const [headers,...rows] = tab.rows;
    const positions = new Map(headers.map((h,i)=>[norm(h),i]));
    for (let i=0;i<rows.length;i++) {
      const ref = `Data-Base-Old|${tab.title}|${tab.firstRow+i+1}`;
      if (ref !== match.ref) continue;
      const get = (name)=>rows[i][positions.get(name)];
      sourceRow = { ref, id:match.id, member: String(get('PHMEMBER') ?? ''), branch:String(get('BRANCH') ?? ''), mas:String(get('MARKETINGAGENT') ?? get('COLLECTEDBY') ?? ''),
        program:String(get('DAYONGPROGRAM') ?? ''), or:String(get('ORNUMBER') ?? ''), orDate:sourceDay(get('ORDATE')),
        dateRemitted:sourceDay(get('DATEREMITTED')), amount:Number(String(get('AMOUNTCOLLECTED') ?? '').replace(/[^0-9.-]/g,'')),
        coverage:sourceCoverage(get('MONTHOF'),get('NOP')), rawHeaders:headers, rawRow:rows[i] };
    }
  }
  if (!sourceRow || canon(sourceRow.or)!==canon(key) || !sourceRow.orDate || !(sourceRow.amount>0)) throw new Error('SOURCE_INVALID');
  if (loadedSources.length) {
    sourceRow.relatedIds=[];
    for(const source of loadedSources)for(const tab of source.tabs){
      if(!/COLL$|NS$/i.test(tab.title))continue;
      const [headers,...rows]=tab.rows, positions=new Map(headers.map((h,i)=>[norm(h),i]));
      rows.forEach((row,i)=>{
        if(norm(row[positions.get('PHMEMBER')])!==norm(sourceRow.member))return;
        const ref=`Data-Base-Old|${tab.title}|${tab.firstRow+i+1}`;
        const prefix=/COLL$/i.test(tab.title)?'COL':'SALE';
        sourceRow.relatedIds.push(`${prefix}-LEG-${createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase()}`);
      });
    }
  }
  db = postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
  await db.begin('isolation level repeatable read read only', async tx=>{
    const accounts = await tx`select a.*, a.doi::text as day, p.program_name, p.program_code, p.base_pay::float8 as rate,
      p.pay_balance_total::float8 as total, p.flexible, p.max_monthly_payment::float8 as maximum, p.registration_fee_required, p.category_id,
      m.surname,m.first_name,m.middle_name,m.name_extension from member_programs a join programs p using(program_id) join members m using(member_id)`;
    const personMatches = a => {
      const forms = [a.middle_name, String(a.middle_name??'').slice(0,1), ''].flatMap(m => [
        [a.surname,a.first_name,m,a.name_extension], [a.first_name,m,a.surname,a.name_extension]
      ]);
      return norm(a.member_number)===norm(sourceRow.member) || forms.some(parts=>norm(parts.filter(Boolean).join(' '))===norm(sourceRow.member)||words(parts.filter(Boolean).join(' '))===words(sourceRow.member));
    };
    const programMatches = a => [programKey(a.program_name),programKey(a.program_code)].includes(programKey(sourceRow.program));
    const relatedIds=sourceRow.relatedIds??[];
    const relatedCollections=relatedIds.length?await tx`select distinct member_id from collections where collection_id in ${tx(relatedIds)}`:[];
    const relatedSales=relatedIds.length?await tx`select distinct member_number from sales where sale_id in ${tx(relatedIds)}`:[];
    const tracedMemberIds=new Set(relatedCollections.map(r=>r.member_id));
    const tracedNumbers=new Set(relatedSales.map(r=>r.member_number));
    const traced = a => tracedMemberIds.has(a.member_id)||tracedNumbers.has(a.member_number);
    const memberProfiles=await tx`select member_id,member_number,surname,first_name,middle_name,name_extension from members`;
    const matchingProfiles=memberProfiles.filter(personMatches);
    const candidates = accounts.filter(a=>programMatches(a)&&norm(a.branch)===norm(sourceRow.branch)&&(confirmedMember?a.member_number===confirmedMember:personMatches(a)||traced(a)));
    const plan = { key, confirmedMember, source:sourceRow, candidates, matchingProfiles, ready:false, checks:{ candidateAccounts:candidates.length, sourceCoverageConfirmed:Boolean(sourceRow.coverage), matchingMemberProfiles:matchingProfiles.length,
      matchingPersonAccounts:accounts.filter(personMatches).length, matchingProgramAccounts:accounts.filter(programMatches).length,
      programAndBranchAccounts:accounts.filter(a=>programMatches(a)&&norm(a.branch)===norm(sourceRow.branch)).length,
      relatedSourceRows:relatedIds.length,relatedExistingMemberMatches:new Set([...tracedMemberIds,...tracedNumbers]).size } };
    if(candidates.length===1 && sourceRow.coverage){
      const a=candidates[0];
      const history=await tx`select *,or_date::text as day from collections where enrollment_id=${a.enrollment_id} order by or_date,collection_id`;
      plan.account=a; plan.history=history;
      let p=sourceRow.coverage;
      const priorCoverage=history.filter(h=>h.status==='Posted').map(h=>({monthFrom:h.month_from,monthTo:h.month_to,nopFrom:h.nop_from,nopTo:h.nop_to}));
      plan.checks.existingHistoryConfirmsDoi=confirmedSequence({doi:a.day,registrationFee:a.registration_fee_required},priorCoverage);
      if(confirmedMember&&!confirmedSequence({doi:a.day,registrationFee:a.registration_fee_required},[p])){
        const nopFrom=monthIndex(p.monthFrom)-monthIndex(a.day.slice(0,7))+saleNops({registrationFee:a.registration_fee_required});
        const corrected={...p,nopFrom,nopTo:nopFrom+monthIndex(p.monthTo)-monthIndex(p.monthFrom)};
        if(confirmedSequence({doi:a.day,registrationFee:a.registration_fee_required},[...priorCoverage,corrected])){
          p=corrected;plan.checks.nopAlignedToConfirmedAccount=true;
        }
      }
      plan.coverage=p;
      plan.checks.sourceSequenceConfirmed=confirmedSequence({doi:a.day,registrationFee:a.registration_fee_required},[p]);
      plan.checks.overlapCount=history.filter(h=>h.status==='Posted' && ((h.month_from<=p.monthTo && h.month_to>=p.monthFrom)||(h.nop_from<=p.nopTo&&h.nop_to>=p.nopFrom))).length;
      try{
        const state=accountState({id:a.enrollment_id,doi:a.day,basePay:a.rate,payBalanceTotal:a.total||0,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum,registrationFee:a.registration_fee_required,forfeitMonths:forfeitMonthsFor(a.category_id)},
          [...history.filter(h=>h.status==='Posted').map(h=>({id:h.collection_id,enrollmentId:a.enrollment_id,orDate:h.day,orNumber:h.or_number,monthFrom:h.month_from,monthTo:h.month_to,nopFrom:h.nop_from,nopTo:h.nop_to,amount:Number(h.amount_collected)})),
            {id:sourceRow.id,enrollmentId:a.enrollment_id,orDate:sourceRow.orDate,orNumber:sourceRow.or,...p,amount:sourceRow.amount}],todayInManila());
        plan.state=state;plan.checks.resultingHistoryValid=true;
      }catch{plan.checks.resultingHistoryValid=false;}
      plan.ready=plan.checks.sourceSequenceConfirmed&&plan.checks.overlapCount===0&&plan.checks.resultingHistoryValid;
    }
    fs.writeFileSync(`legacy-data/receipt-${key}-import-plan-private.json`,JSON.stringify(plan,null,2));
    console.log(JSON.stringify({...plan.checks,ready:plan.ready,privatePlanSaved:true}));
  });
}
main().catch(e=>{fs.writeFileSync('backups/receipt-import-prepare-error-private.json',JSON.stringify({message:e.message,code:e.code}));console.error('Preparation stopped; private diagnostic saved.');process.exitCode=1;}).finally(async()=>{if(db)await db.end();});
