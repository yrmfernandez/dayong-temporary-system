/** Read-only production/staging data audit; full findings stay in ignored legacy-data (no names/contact details). */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, monthIndex, validMonth, paymentsByEnrollment } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max:1, connect_timeout:15, onnotice:()=>{} });
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? '')?.[1] ?? 'unknown';
const today = process.argv.find(arg=>arg.startsWith('--as-of='))?.slice(8) ?? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('--as-of must be YYYY-MM-DD.');
const report = { project, asOf:today, generatedAt:new Date().toISOString(), scope:'All public-table foreign keys; detailed member, enrollment, sale, collection, remittance and finance checks. Read-only repeatable-read snapshot. IDs and codes only.', counts:{}, checks:[] };
const add = (name, classification, rows, unit='records') => {
  const recent = rows.filter(r => r.legacy === false).length;
  report.checks.push({name,classification,count:rows.length,unit,nonLegacy:recent,rows});
  console.log(`${classification}: ${name}: ${rows.length} ${unit}${rows.some(r=>typeof r.legacy==='boolean') ? ` (${recent} entered in this system)` : ''}`);
};
try {
 await sql.begin('isolation level repeatable read read only', async tx => {
  await tx`select set_config('statement_timeout','45000',true)`;
  const check = async (name,classification,query,unit) => add(name,classification,await query,unit);
  const tables = ['members','member_programs','programs','sales','collections','remittances','employees','expenses','cash_transactions','vendor_payables'];
  for (const table of tables) { const [r] = await tx`select count(*)::int as n from ${tx(table)}`; report.counts[table]=r.n; }
  // Check every declared FK, including employee, attendance, payroll and finance relations.
  const fks = await tx`select conname,conrelid::regclass::text as child,confrelid::regclass::text as parent,array(select attname from pg_attribute where attrelid=conrelid and attnum=any(conkey) order by array_position(conkey,attnum)) as child_cols,array(select attname from pg_attribute where attrelid=confrelid and attnum=any(confkey) order by array_position(confkey,attnum)) as parent_cols from pg_constraint where contype='f' and connamespace='public'::regnamespace`;
  const broken=[];
  for (const fk of fks) {
    const quote = s => '"'+s.replaceAll('"','""')+'"';
    const join = fk.child_cols.map((c,i)=>`c.${quote(c)}=p.${quote(fk.parent_cols[i])}`).join(' and ');
    const present = fk.child_cols.map(c=>`c.${quote(c)} is not null`).join(' and ');
    const [r] = await tx.unsafe(`select count(*)::int as n from ${fk.child.split('.').map(quote).join('.')} c where ${present} and not exists(select 1 from ${fk.parent.split('.').map(quote).join('.')} p where ${join})`);
    if(r.n) broken.push({constraint:fk.conname,table:fk.child,count:r.n});
  }
  report.foreignKeysChecked=fks.length;
  add('Broken declared foreign keys','integrity',broken,'constraints');
  await check('Collection owner/program differs from enrollment','integrity',tx`select c.collection_id as id,c.collection_id ~ '-(LEG|WEB)-' as legacy,m.member_number,c.enrollment_id,c.program_id,mp.program_id as account_program,c.member_id,mp.member_id as account_member from collections c join member_programs mp on mp.enrollment_id=c.enrollment_id left join members m on m.member_id=c.member_id where c.member_id<>mp.member_id or c.program_id<>mp.program_id`);
  await check('Collection member-number copy differs from member','integrity',tx`select c.collection_id as id,c.collection_id ~ '-(LEG|WEB)-' as legacy,c.member_number as stored,m.member_number as actual from collections c join members m on m.member_id=c.member_id where nullif(trim(c.member_number),'') is not null and c.member_number<>m.member_number`);
  await check('Enrollment member-number copy differs from member','integrity',tx`select a.enrollment_id as id,a.enrollment_id ~ '-(LEG|WEB)-' as legacy,a.member_number as stored,m.member_number as actual from member_programs a join members m on m.member_id=a.member_id where nullif(trim(a.member_number),'') is not null and a.member_number<>m.member_number`);
  await check('Sales without matching member/program enrollment','review',tx`select s.sale_id as id,s.sale_id ~ '-(LEG|WEB)-' as legacy,s.member_number,s.program_id from sales s where not exists(select 1 from members m join member_programs a on a.member_id=m.member_id where m.member_number=s.member_number and a.program_id=s.program_id)`);
  await check('Duplicate member/program enrollments','integrity',tx`select member_id,program_id,count(*)::int as copies,array_agg(enrollment_id order by enrollment_id) as ids from member_programs group by member_id,program_id having count(*)>1`,'groups');
  await check('Posted collections sharing exact normalized OR','review',tx`select or_key,count(*)::int as copies,array_agg(collection_id order by collection_id) as ids,array_agg(distinct member_id) as members from collections where status='Posted' and or_key<>'' group by or_key having count(*)>1`,'groups');
  await check('Sales sharing exact normalized application','review',tx`select application_key,count(*)::int as copies,array_agg(sale_id order by sale_id) as ids from sales where application_key<>'' group by application_key having count(*)>1`,'groups');
  await check('Possible duplicate people (same normalized name and birthdate)','review',tx`select count(*)::int as copies,array_agg(member_number order by member_number) as members from members where birthdate is not null and trim(first_name)<>'' and trim(surname)<>'' group by regexp_replace(lower(surname),'[^a-z0-9]','','g'),regexp_replace(lower(first_name),'[^a-z0-9]','','g'),birthdate having count(*)>1`,'groups');
  await check('Legacy duplicate flags / marked ORs remaining','review',tx`select c.collection_id as id,c.collection_id ~ '-(LEG|WEB)-' as legacy,m.member_number,c.or_number,c.legacy_duplicate from collections c left join members m on m.member_id=c.member_id where c.status='Posted' and (c.legacy_duplicate or c.or_number ilike '%(duplicated%')`);
  await check('ORs without branch letter (digits only)','review',tx`select collection_id as id,collection_id ~ '-(LEG|WEB)-' as legacy,or_number from collections where status='Posted' and trim(or_number) ~ '^[0-9]+$'`);
  await check('Other malformed/missing ORs (excluding marked duplicates)','review',tx`select collection_id as id,collection_id ~ '-(LEG|WEB)-' as legacy,or_number from collections where status='Posted' and coalesce(or_number,'') not ilike '%(duplicated%' and trim(coalesce(or_number,'')) !~ '^[0-9]+[[:space:]]?[A-Za-z]$' and trim(coalesce(or_number,'')) !~ '^[0-9]+$'`);
  await check('Incomplete application numbers','review',tx`select sale_id as id,sale_id ~ '-(LEG|WEB)-' as legacy,application_no from sales where trim(coalesce(application_no,''))='' or application_no ilike '%(need edit%' or trim(application_no) ~* '^[0-9]{4}[A-Z]+-?$'`);
  await check('Missing/impossible/future collection OR dates','integrity',tx`select collection_id as id,collection_id ~ '-(LEG|WEB)-' as legacy,or_number,or_date::text from collections where status='Posted' and (or_date is null or or_date<'2000-01-01' or or_date>${today}::date)`);
  await check('Missing/impossible/future sale OR dates','review',tx`select sale_id as id,sale_id ~ '-(LEG|WEB)-' as legacy,or_number,or_date::text from sales where or_date is null or or_date<'2000-01-01' or or_date>${today}::date`);
  await check('Missing/impossible/future enrollment DOI','integrity',tx`select enrollment_id as id,enrollment_id ~ '-(LEG|WEB)-' as legacy,doi::text from member_programs where doi is null or doi<'2000-01-01' or doi>${today}::date`);
  await check('Collection receipt predates account DOI','review',tx`select c.collection_id as id,c.collection_id ~ '-(LEG|WEB)-' as legacy,c.or_number,c.or_date::text,mp.doi::text from collections c join member_programs mp on mp.enrollment_id=c.enrollment_id where c.status='Posted' and c.or_date<mp.doi`);
  await check('Remitted before receipt / future remittance date','integrity',tx`select collection_id as id,collection_id ~ '-(LEG|WEB)-' as legacy,or_number,or_date::text,date_remitted::text from collections where status='Posted' and (date_remitted<or_date or date_remitted>${today}::date) union all select sale_id,sale_id ~ '-(LEG|WEB)-',or_number,or_date::text,date_remitted::text from sales where date_remitted<or_date or date_remitted>${today}::date`);
  await check('Receipt dated after encoding (entered in this system only)','review',tx`select collection_id as id,false as legacy,or_number,or_date::text,(encoded_at at time zone 'Asia/Manila')::date::text as encoded_on from collections where collection_id !~ '-(LEG|WEB)-' and status='Posted' and or_date>(encoded_at at time zone 'Asia/Manila')::date union all select sale_id,false,or_number,or_date::text,(encoded_at at time zone 'Asia/Manila')::date::text from sales where sale_id !~ '-(LEG|WEB)-' and or_date>(encoded_at at time zone 'Asia/Manila')::date`);
  await check('Nonpositive posted collection amounts','integrity',tx`select collection_id as id,collection_id ~ '-(LEG|WEB)-' as legacy,amount_collected from collections where status='Posted' and amount_collected<=0`);
  await check('Missing/nonpositive program base pay','review',tx`select program_id as id,program_code,base_pay,status from programs where coalesce(base_pay,0)<=0`);
  await check('Missing member identification/contact details','completeness',tx`select member_id as id,member_id ~ '-(LEG|WEB)-' as legacy,member_number,birthdate is null as missing_birthdate,trim(coalesce(member_contact,''))='' as missing_contact,trim(coalesce(address,''))='' as missing_address from members where coalesce(status,'') !~* 'deceased|inactive' and (birthdate is null or trim(coalesce(member_contact,''))='' or trim(coalesce(address,''))='')`);
  await check('Invalid member birthdates','integrity',tx`select member_id as id,member_id ~ '-(LEG|WEB)-' as legacy,member_number from members where birthdate>${today}::date or birthdate<'1900-01-01'`);
  await check('Collection remittance status disagrees with linked slip','review',tx`select c.collection_id as id,c.collection_id ~ '-(LEG|WEB)-' as legacy,c.remittance_status,c.linked_remittance_id,r.status as slip_status from collections c left join remittances r on r.remittance_id=c.linked_remittance_id where c.status='Posted' and ((c.remittance_status in ('Approved','Remitted') and (c.collection_id !~ '-(LEG|WEB)-' or c.linked_remittance_id is not null) and (r.remittance_id is null or r.status<>'Approved')) or (c.linked_remittance_id is not null and c.remittance_status='Outstanding'))`);
  await check('Sale remittance status disagrees with linked slip','review',tx`select s.sale_id as id,s.sale_id ~ '-(LEG|WEB)-' as legacy,s.remittance_status,s.linked_remittance_id,r.status as slip_status from sales s left join remittances r on r.remittance_id=s.linked_remittance_id where (s.remittance_status in ('Approved','Remitted') and (s.sale_id !~ '-(LEG|WEB)-' or s.linked_remittance_id is not null) and (r.remittance_id is null or r.status<>'Approved')) or (s.linked_remittance_id is not null and s.remittance_status='Outstanding')`);
  // Mapping collection_id is polymorphic: it may contain a sale_id. Mapping amount is the NET company share.
  await check('Remittance detail points at absent collection AND sale','integrity',tx`select rc.remittance_collection_id as id,false as legacy,rc.collection_id from remittance_collections rc left join collections c on c.collection_id=rc.collection_id left join sales s on s.sale_id=rc.collection_id where c.collection_id is null and s.sale_id is null`);
  await check('Active remittance detail net amount / slip differs from source','review',tx`select rc.remittance_collection_id as id,false as legacy,rc.collection_id,rc.remittance_id,c.linked_remittance_id,rc.amount,c.remittance_amount as expected from remittance_collections rc join remittances r on r.remittance_id=rc.remittance_id join collections c on c.collection_id=rc.collection_id where r.status not in ('Rejected','Voided') and (rc.remittance_id is distinct from c.linked_remittance_id or rc.amount is distinct from coalesce(c.remittance_amount,0)) union all select rc.remittance_collection_id,false,rc.collection_id,rc.remittance_id,s.linked_remittance_id,rc.amount,coalesce(s.remittance_amount,s.amount_paid) from remittance_collections rc join remittances r on r.remittance_id=rc.remittance_id join sales s on s.sale_id=rc.collection_id where r.status not in ('Rejected','Voided') and (rc.remittance_id is distinct from s.linked_remittance_id or rc.amount is distinct from coalesce(s.remittance_amount,s.amount_paid))`);
  await check('Remittance expected total differs from mappings plus Fidelity','review',tx`select r.remittance_id as id,false as legacy,r.status,r.gross_collection,coalesce(sum(rc.amount),0)+coalesce(r.fidelity_amount,0) as expected from remittances r left join remittance_collections rc on rc.remittance_id=r.remittance_id group by r.remittance_id having r.gross_collection is distinct from coalesce(sum(rc.amount),0)+coalesce(r.fidelity_amount,0)`);
  await check('Duplicate remittance mappings for same slip and entry','integrity',tx`select remittance_id,collection_id,count(*)::int as copies from remittance_collections group by remittance_id,collection_id having count(*)>1`,'groups');
  await check('Locked New Sale amount differs from current program rule','review',tx`select s.sale_id as id,s.sale_id ~ '-(LEG|WEB)-' as legacy,s.member_number,s.program_id,s.amount_paid,case when p.registration_fee_required then p.registration_amount else p.base_pay end as expected from sales s join programs p on p.program_id=s.program_id where not coalesce(p.new_sale_amount_editable,false) and not coalesce(p.flexible,false) and s.amount_paid is distinct from case when p.registration_fee_required then p.registration_amount else p.base_pay end`);
  await check('Vendor payable balance arithmetic','integrity',tx`select payable_id as id,amount,amount_paid,balance from vendor_payables where amount<0 or amount_paid<0 or amount_paid>amount or balance is distinct from (amount-coalesce(amount_paid,0))`);
  await check('Nonpositive active expenses/cash transactions','integrity',tx`select expense_id as id,amount,status from expenses where lower(coalesce(status,''))<>'void' and coalesce(amount,0)<=0 union all select transaction_id,amount,status from cash_transactions where lower(coalesce(status,''))<>'void' and coalesce(amount,0)<=0`);
  // Apply application rules to every account, including imported history, without exporting member details.
  const accounts = await tx`select a.enrollment_id as id,a.member_id as "memberId",m.member_number as "memberNumber",a.program_id as "programId",a.doi::text,a.account_status as "storedStatus",p.base_pay::float8 as "basePay",coalesce(p.pay_balance_total,0)::float8 as "payBalanceTotal",p.flexible,p.max_monthly_payment::float8 as "maxMonthlyPayment" from member_programs a join members m on m.member_id=a.member_id join programs p on p.program_id=a.program_id`;
  const payments = await tx`select c.collection_id as id,c.enrollment_id as "enrollmentId",c.or_number as "orNumber",c.or_date::text as "orDate",c.month_from as "monthFrom",c.month_to as "monthTo",c.nop_from as "nopFrom",c.nop_to as "nopTo",c.amount_collected::float8 as amount,c.date_remitted::text as "dateRemitted" from collections c where c.status='Posted'`;
  const grouped = paymentsByEnrollment(payments), invalid=[], offsets=[], statuses=[], sequences=[], amounts=[];
  for (const a of accounts) {
    const history=grouped.get(a.id)??[];
    const base={id:a.id,legacy:a.id.match(/-(LEG|WEB)-/) !== null,member:a.memberNumber};
    try { const state=accountState({...a,branch:'',mas:''},history,today); if (a.storedStatus !== state.status) statuses.push({...base,stored:a.storedStatus,calculated:state.status}); }
    catch(e){invalid.push({...base,problem:e.message});}
    const sorted=[...history].sort((x,y)=>(x.orDate??'').localeCompare(y.orDate??'')||x.id.localeCompare(y.id));
    for(let i=0;i<sorted.length;i++) {
      const p=sorted[i]; const item={id:p.id,legacy:p.id.match(/-(LEG|WEB)-/) !== null,member:a.memberNumber,account:a.id,or:p.orNumber};
      if(validMonth(p.monthFrom)&&validMonth(p.monthTo)&&a.doi) {
        const expected=monthIndex(p.monthFrom)-monthIndex(a.doi.slice(0,7))+1;
        if(expected!==p.nopFrom) offsets.push({...item,month:p.monthFrom,nop:p.nopFrom,expected});
        const count=monthIndex(p.monthTo)-monthIndex(p.monthFrom)+1;
        const expectedAmount=Math.round(a.basePay*100)*count;
        const paid=history.filter(x=>(x.orDate??'')<=(p.orDate??'')).reduce((sum,x)=>sum+Math.round(x.amount*100),0);
        const payoff=a.payBalanceTotal>0&&paid===Math.round(a.payBalanceTotal*100);
        const aboveMaximum = a.flexible && a.maxMonthlyPayment > 0 && Math.round(p.amount*100)>Math.round(a.maxMonthlyPayment*100)*count && !payoff;
        if(count>0&&(Math.round(p.amount*100)<expectedAmount||(!a.flexible&&!payoff&&Math.round(p.amount*100)>expectedAmount)||aboveMaximum)) amounts.push({...item,amount:p.amount,months:count,rate:a.basePay,expected:expectedAmount/100,flexible:a.flexible,maximum:a.maxMonthlyPayment});
      }
      const prev=sorted[i-1];
      if(prev&&p.orDate!==prev.orDate&&p.nopFrom<prev.nopFrom) sequences.push({...item,date:p.orDate,nop:p.nopFrom,previousOr:prev.orNumber,previousDate:prev.orDate,previousNop:prev.nopFrom});
    }
  }
  add('Account histories failing application validation','integrity',invalid,'accounts');
  add('Payment NOP inconsistent with DOI and covered month','integrity',offsets);
  add('Stored account status differs from current calculation','review',statuses,'accounts');
  add('Later receipt date has earlier payment number','review',sequences);
  add('Collection amount differs from current program coverage rule','review',amounts);
 });
 const base=`legacy-data/database-audit-${today}-${project}`;
 fs.mkdirSync('legacy-data',{recursive:true});
 fs.writeFileSync(`${base}.json`,JSON.stringify(report,null,2));
 const lines=['# Database data audit', '', `As of ${today}; project ${project}. Read-only; no database records changed.`, '', report.scope,'',`Foreign keys checked: ${report.foreignKeysChecked}.`,'','## Rows scanned','',...Object.entries(report.counts).map(([table,count])=>`- ${table}: ${count.toLocaleString('en-US')}`),'','## Findings','', '| Check | Classification | Count | Unit | Entered in this system* |','| --- | --- | ---: | --- | ---: |',...report.checks.map(c=>`| ${c.name} | ${c.classification} | ${c.count} | ${c.unit} | ${c.nonLegacy} |`),'','*Entered in this system is counted only where a per-record legacy flag is available. Imported means IDs from either the old sheet (-LEG-) or old website (-WEB-). Rejected/voided remittance mappings are historical and excluded from source-mismatch checks. Counts overlap; do not add them together. Review findings need source documents or context and are not automatically proven errors. Imported histories and current program rates may differ. Stored status is time-dependent and may be a stale cache. Blank copied member numbers are not counted as conflicting copies.','', 'This audit cannot establish whether a receipt belongs to the correct person or month when the stored history is internally consistent; compare paper receipts/member ledgers for that. It does not recompute payroll, incentive entitlement, bank reconciliation or every business rule.','', '## Examples (up to five per check; full rows in adjacent JSON)',''];
 for(const c of report.checks.filter(c=>c.count)){lines.push(`### ${c.name}`,'','```json',JSON.stringify(c.rows.slice(0,5),null,2),'```','');}
 fs.writeFileSync(`${base}.md`,lines.join('\n'));
 console.log(`Reports: ${base}.md and .json`);
} finally {await sql.end();}
